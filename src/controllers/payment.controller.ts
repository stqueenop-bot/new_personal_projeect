import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { zapUPIService } from '../services/zapupi.service';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger.js';
import { PaymentSuccessMessage, PaymentFailedMessage, ApiResponse } from '../types';
import { prisma } from '../../lib/initiatePrisma';

// ===================== Validation Schemas =====================

export const createPaymentSchema = z.object({
    orderId: z.string().uuid('orderId must be a valid UUID'),
});

export const webhookSchema = z.object({
    order_id: z.string().min(1, 'order_id is required'),
    status: z.string().min(1, 'status is required'),
    utr: z.string().optional(),
    txn_id: z.string().optional(),
    amount: z.number().optional(),
    reason: z.string().optional(),
});

// ===================== Controller =====================

/**
 * POST /api/payments/create
 * Initiates ZapUPI UPI payment for an existing Order.
 * Returns a payment_url to redirect the user.
 */
export async function createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { orderId } = req.body as z.infer<typeof createPaymentSchema>;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { payment: true },
        });

        if (!order) {
            return next(createError('Order not found', 404));
        }

        if (order.payment) {
            if (order.payment.status === PaymentStatus.SUCCESS) {
                return next(createError('Order already paid', 409));
            }
            if (order.payment.status === PaymentStatus.PENDING && order.payment.paymentUrl) {
                const response: ApiResponse = {
                    success: true,
                    message: 'Existing payment URL returned',
                    data: {
                        paymentUrl: order.payment.paymentUrl,
                        zapupiOrderId: order.payment.zapupiOrderId,
                        orderId: order.id,
                    },
                };
                res.json(response);
                return;
            }
        }

        const zapupiOrderId = `SMM-${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;

        const zapupiResponse = await zapUPIService.createOrder({
            amount: order.amount,
            orderId: zapupiOrderId,
            remark: `Instagram SMM Order #${order.id.substring(0, 8)}`,
        });

        if (zapupiResponse.status !== 'success' || !zapupiResponse.payment_url) {
            logger.error('[PaymentController] ZapUPI error:', zapupiResponse);
            return next(createError(`Payment gateway error: ${zapupiResponse.message}`, 502));
        }

        await prisma.payment.upsert({
            where: { orderId: order.id },
            create: {
                zapupiOrderId,
                orderId: order.id,
                amount: order.amount,
                paymentUrl: zapupiResponse.payment_url,
                status: PaymentStatus.PENDING,
            },
            update: {
                zapupiOrderId,
                paymentUrl: zapupiResponse.payment_url,
                status: PaymentStatus.PENDING,
            },
        });

        const response: ApiResponse = {
            success: true,
            message: 'Payment order created successfully',
            data: {
                paymentUrl: zapupiResponse.payment_url,
                zapupiOrderId,
                orderId: order.id,
                amount: order.amount,
            },
        };

        res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/payments/webhook
 * Handles ZapUPI payment callback (success/failure).
 * Publishes to RabbitMQ for async processing.
 */
export async function handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const body = req.body as z.infer<typeof webhookSchema>;
        const { order_id: zapupiOrderId, status, utr, txn_id, reason } = body;

        logger.info(`[PaymentController] Webhook received: orderId=${zapupiOrderId}, status=${status}`);

        const payment = await prisma.payment.findUnique({
            where: { zapupiOrderId },
            include: { order: true },
        });

        if (!payment) {
            logger.warn(`[PaymentController] Webhook for unknown order: ${zapupiOrderId}`);
            res.json({ success: true, message: 'Order not found but acknowledged' });
            return;
        }

        if (payment.status !== PaymentStatus.PENDING) {
            logger.info(`[PaymentController] Webhook already processed for: ${zapupiOrderId}`);
            res.json({ success: true, message: 'Already processed' });
            return;
        }

        // Verify payment status against ZapUPI API (double-check before trusting webhook)
        let verifiedStatus = status;
        try {
            const liveStatus = await zapUPIService.getOrderStatus(zapupiOrderId);
            if (liveStatus.status === 'success' && liveStatus.data) {
                verifiedStatus = 'success';
                logger.info(`[PaymentController] Payment verified via API: ${zapupiOrderId}`);
            }
        } catch (verifyErr) {
            logger.warn(`[PaymentController] Could not verify payment via API, trusting webhook:`, verifyErr);
        }

        if (verifiedStatus === 'success') {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.SUCCESS, utr: utr ?? '', zapupiTxnId: txn_id },
            });

            const message: PaymentSuccessMessage = {
                orderId: payment.orderId,
                paymentId: payment.id,
                serviceId: payment.order.serviceId,
                link: payment.order.link,
                quantity: payment.order.quantity,
                amount: payment.amount,
                utr: utr ?? '',
                customerMobile: payment.customerMobile ?? undefined,
                timestamp: new Date().toISOString(),
            };

            await rabbitMQService.publishToQueue(QUEUES.PAYMENT_SUCCESS, message);
            logger.success(`[PaymentController] Queued payment_success for order: ${payment.orderId}`);
        } else {
            const failureReason = reason ?? `Payment status: ${verifiedStatus}`;

            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.FAILED, failureReason },
            });

            const message: PaymentFailedMessage = {
                orderId: payment.orderId,
                paymentId: payment.id,
                amount: payment.amount,
                reason: failureReason,
                customerMobile: payment.customerMobile ?? undefined,
                timestamp: new Date().toISOString(),
            };

            await rabbitMQService.publishToQueue(QUEUES.PAYMENT_FAILED, message);
            logger.warn(`[PaymentController] Queued payment_failed for order: ${payment.orderId}`);
        }

        res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/payments/status/:orderId
 * Check live payment status from ZapUPI API.
 */
export async function getPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const orderId = String(req.params.orderId);

        const payment = await prisma.payment.findFirst({
            where: {
                OR: [
                    { orderId },
                    { zapupiOrderId: orderId },
                ],
            },
        });

        if (!payment) {
            // Payment record doesn't exist yet — ZapUPI order may not have been created.
            // Return a soft response instead of 404 so polling doesn't spam errors.
            const response: ApiResponse = {
                success: true,
                message: 'Payment not yet created for this order',
                data: {
                    payment: null,
                    status: 'NOT_CREATED',
                    liveStatus: null,
                },
            };
            res.json(response);
            return;
        }

        let liveStatus = null;
        try {
            liveStatus = await zapUPIService.getOrderStatus(payment.zapupiOrderId);

            // AUTO-SYNC: If ZapUPI says paid but DB still PENDING, sync the status
            // This handles cases where webhook can't reach localhost (dev mode)
            if (liveStatus?.status === 'success' && payment.status === 'PENDING') {
                const liveData = liveStatus.data;
                const normalizedStatus = liveData?.status?.toLowerCase();
                const isPaid = normalizedStatus === 'success';
                const isFailed = normalizedStatus === 'failed';

                if (isPaid) {
                    logger.info(`[PaymentController] Auto-syncing payment ${payment.zapupiOrderId} to SUCCESS (from ZapUPI live check)`);

                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: 'SUCCESS',
                            utr: liveData?.utr || liveData?.txn_id || null,
                            zapupiTxnId: liveData?.txn_id || null,
                        },
                    });

                    await prisma.order.update({
                        where: { id: payment.orderId },
                        data: { status: 'PROCESSING' },
                    });

                    try {
                        const order = await prisma.order.findUnique({ where: { id: payment.orderId } });
                        if (order) {
                            const { rabbitMQService, QUEUES } = await import('../services/rabbitmq.service');
                            await rabbitMQService.publishToQueue(QUEUES.PAYMENT_SUCCESS, {
                                orderId: payment.orderId,
                                paymentId: payment.id,
                                serviceId: order.serviceId,
                                link: order.link,
                                quantity: order.quantity,
                                amount: payment.amount,
                                utr: liveData?.utr || liveData?.txn_id || null,
                                timestamp: new Date().toISOString(),
                            });
                            logger.info(`[PaymentController] Published PAYMENT_SUCCESS for order ${payment.orderId}`);
                        }
                    } catch (mqErr) {
                        logger.error('[PaymentController] Failed to publish to RabbitMQ:', mqErr);
                    }

                    const syncedResponse: ApiResponse = {
                        success: true,
                        message: 'Payment confirmed (synced from ZapUPI)',
                        data: {
                            payment: { id: payment.id, orderId: payment.orderId, amount: payment.amount, status: 'SUCCESS', utr: liveData?.utr || liveData?.txn_id || null, zapupiOrderId: payment.zapupiOrderId, paymentUrl: payment.paymentUrl, createdAt: payment.createdAt, updatedAt: new Date() },
                            liveStatus: liveData,
                        },
                    };
                    res.json(syncedResponse);
                    return;
                }

                if (isFailed) {
                    logger.info(`[PaymentController] Auto-syncing payment ${payment.zapupiOrderId} to FAILED (from ZapUPI live check)`);

                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: { status: 'FAILED', failureReason: 'Payment failed on ZapUPI' },
                    });

                    await prisma.order.update({
                        where: { id: payment.orderId },
                        data: { status: 'FAILED' },
                    });

                    try {
                        const { rabbitMQService, QUEUES } = await import('../services/rabbitmq.service');
                        await rabbitMQService.publishToQueue(QUEUES.PAYMENT_FAILED, {
                            orderId: payment.orderId,
                            paymentId: payment.id,
                            amount: payment.amount,
                            reason: 'Payment failed on ZapUPI',
                            timestamp: new Date().toISOString(),
                        });
                    } catch (mqErr) {
                        logger.error('[PaymentController] Failed to publish to RabbitMQ:', mqErr);
                    }

                    const failedResponse: ApiResponse = {
                        success: true,
                        message: 'Payment failed (synced from ZapUPI)',
                        data: {
                            payment: { id: payment.id, orderId: payment.orderId, amount: payment.amount, status: 'FAILED', utr: null, zapupiOrderId: payment.zapupiOrderId, paymentUrl: payment.paymentUrl, createdAt: payment.createdAt, updatedAt: new Date() },
                            liveStatus: liveData,
                        },
                    };
                    res.json(failedResponse);
                    return;
                }
            }
        } catch {
            logger.warn(`[PaymentController] Could not fetch live status for ${payment.zapupiOrderId}`);
        }

        const response: ApiResponse = {
            success: true,
            message: 'Payment status retrieved',
            data: {
                payment: {
                    id: payment.id,
                    orderId: payment.orderId,
                    amount: payment.amount,
                    status: payment.status,
                    utr: payment.utr,
                    zapupiOrderId: payment.zapupiOrderId,
                    paymentUrl: payment.paymentUrl,
                    createdAt: payment.createdAt,
                    updatedAt: payment.updatedAt,
                },
                liveStatus: liveStatus?.data ?? null,
            },
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

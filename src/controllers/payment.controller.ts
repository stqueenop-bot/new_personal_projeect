import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { OrderStatus, PaymentStatus } from '../../generated/prisma/index';
import { zapUPIService } from '../services/zapupi.service';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { PaymentSuccessMessage, PaymentFailedMessage, ApiResponse } from '../types';
import { prisma } from '../../lib/initiatePrisma'; import { env } from '../config/env';
// ===================== Validation Schemas =====================

export const createPaymentSchema = z.object({
    orderId: z.string().uuid('orderId must be a valid UUID'),
});

export const webhookSchema = z.object({
    order_id: z.string().optional(),
    orderId: z.string().optional(),
    status: z.string().min(1, 'status is required'),
    utr: z.string().optional(),
    txn_id: z.string().optional(),
    txnId: z.string().optional(),
    amount: z.union([z.number(), z.string()]).optional(),
    reason: z.string().optional(),
}).refine(data => data.order_id || data.orderId, {
    message: "Either order_id or orderId must be provided",
    path: ["order_id"]
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

        const isSuccess = zapupiResponse.status === true || zapupiResponse.status === 'true';
        if (!isSuccess || !zapupiResponse.result?.payment_url) {
            logger.error('[PaymentController] ZapUPI error:', zapupiResponse);
            return next(createError(`Payment gateway error: ${zapupiResponse.message}`, 502));
        }

        await prisma.payment.upsert({
            where: { orderId: order.id },
            create: {
                zapupiOrderId,
                orderId: order.id,
                amount: order.amount,
                paymentUrl: zapupiResponse.result.payment_url,
                status: PaymentStatus.PENDING,
            },
            update: {
                zapupiOrderId,
                paymentUrl: zapupiResponse.result.payment_url,
                status: PaymentStatus.PENDING,
            },
        });

        const response: ApiResponse = {
            success: true,
            message: 'Payment order created successfully',
            data: {
                paymentUrl: zapupiResponse.result.payment_url,
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
        const zapupiOrderId = body.order_id || body.orderId;
        const { status, utr, txn_id, txnId, reason } = body;
        const transactionId = txn_id || txnId;

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

        // ─── MANDATORY: Verify payment via ZapUPI API (never trust webhook alone) ───
        let verifiedStatus: string | null = null;
        let verifiedAmount: number | null = null;
        try {
            const liveStatus = await zapUPIService.getOrderStatus(zapupiOrderId);
            if (liveStatus.status === 'COMPLETED' && liveStatus.result) {
                const normalizedStatus = liveStatus.result.status?.toLowerCase?.() ?? '';
                if (normalizedStatus === 'success' || normalizedStatus === 'completed') {
                    verifiedStatus = 'success';
                    verifiedAmount = Number(liveStatus.result.amount) || null;
                } else if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
                    verifiedStatus = 'failed';
                }
                logger.info(`[PaymentController] ZapUPI API verified: status=${verifiedStatus}, amount=${verifiedAmount}`);
            } else if (liveStatus.status === 'ERROR') {
                logger.warn(`[PaymentController] ZapUPI API returned error status for ${zapupiOrderId}: ${liveStatus.message}`);
                verifiedStatus = 'failed';
            }
        } catch (verifyErr) {
            // DO NOT fall back to trusting webhook — keep PENDING for admin review
            logger.error(`[PaymentController] ZapUPI API verification FAILED for ${zapupiOrderId}. Payment stays PENDING for manual review.`, verifyErr);
            res.json({ success: true, message: 'Verification pending — will retry' });
            return;
        }

        // If API didn't confirm success or failure, keep PENDING
        if (!verifiedStatus) {
            logger.warn(`[PaymentController] ZapUPI API returned no definitive status for ${zapupiOrderId}. Keeping PENDING.`);
            res.json({ success: true, message: 'Payment status inconclusive — keeping pending' });
            return;
        }

        if (verifiedStatus === 'success') {
            // ─── AMOUNT VERIFICATION: Reject if paid amount doesn't match expected ───
            if (verifiedAmount !== null && Math.abs(verifiedAmount - payment.amount) > 0.01) {
                logger.error(`[PaymentController] AMOUNT MISMATCH for ${zapupiOrderId}! Expected ₹${payment.amount}, ZapUPI says ₹${verifiedAmount}. Flagging as suspicious.`);

                await prisma.payment.update({
                    where: { id: payment.id },
                    data: {
                        status: PaymentStatus.FAILED,
                        failureReason: `Amount mismatch: expected ₹${payment.amount}, received ₹${verifiedAmount}`,
                    },
                });

                await prisma.order.update({
                    where: { id: payment.orderId },
                    data: { status: OrderStatus.FAILED },
                });

                res.json({ success: true, message: 'Payment amount mismatch — flagged for review' });
                return;
            }

            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.SUCCESS, utr: utr ?? '', zapupiTxnId: txn_id },
            });

            // Ensure order moves to PROCESSING after verified payment success
            await prisma.order.update({
                where: { id: payment.orderId },
                data: { status: OrderStatus.PROCESSING },
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

            await prisma.order.update({
                where: { id: payment.orderId },
                data: { status: OrderStatus.FAILED },
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
async function expireStalePayments(): Promise<void> {
    const timeoutMs = env.PAYMENT_TIMEOUT_MINUTES * 60 * 1000;
    const cutoff = new Date(Date.now() - timeoutMs);

    const stalePendingPayments = await prisma.payment.findMany({
        where: {
            status: 'PENDING',
            createdAt: { lt: cutoff },
        },
        include: { order: true },
    });

    for (const payment of stalePendingPayments) {
        logger.warn(`[PaymentController] Expiring stale payment ${payment.id} for order ${payment.orderId}`);

        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: 'EXPIRED',
                failureReason: 'Payment timeout exceeded',
            },
        });

        if (payment.order && ['PENDING', 'PROCESSING'].includes(payment.order.status)) {
            await prisma.order.update({
                where: { id: payment.orderId },
                data: { status: 'FAILED' },
            });
            try {
                await rabbitMQService.publishToQueue(QUEUES.PAYMENT_FAILED, {
                    orderId: payment.orderId,
                    paymentId: payment.id,
                    amount: payment.amount,
                    reason: 'Payment timed out',
                    timestamp: new Date().toISOString(),
                });
            } catch (mqErr) {
                logger.error('[PaymentController] Failed to publish PAYMENT_FAILED for expired payment:', mqErr);
            }
        }
    }
}

export async function getPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        await expireStalePayments();

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
            if (liveStatus?.status === 'COMPLETED' && payment.status === 'PENDING') {
                const liveData = liveStatus.result;
                const normalizedStatus = liveData?.status?.toLowerCase();
                const isPaid = normalizedStatus === 'success' || normalizedStatus === 'completed' || normalizedStatus === 'paid';
                const isFailed = normalizedStatus === 'failed' || normalizedStatus === 'error';

                if (isPaid && liveData) {
                    logger.info(`[PaymentController] Auto-syncing payment ${payment.zapupiOrderId} to SUCCESS (from ZapUPI live check)`);

                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: 'SUCCESS',
                            utr: liveData.utr || liveData.orderId || null,
                            zapupiTxnId: liveData.orderId || null,
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
                                utr: liveData.utr || liveData.orderId || null,
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
                            payment: { id: payment.id, orderId: payment.orderId, amount: payment.amount, status: 'SUCCESS', utr: liveData.utr || liveData.orderId || null, zapupiOrderId: payment.zapupiOrderId, paymentUrl: payment.paymentUrl, createdAt: payment.createdAt, updatedAt: new Date() },
                            liveStatus: liveData,
                        },
                    };
                    res.json(syncedResponse);
                    return;
                }

                if (isFailed && liveData) {
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
                liveStatus: liveStatus?.result ?? null,
            },
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

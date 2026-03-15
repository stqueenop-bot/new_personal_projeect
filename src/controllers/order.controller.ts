import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { OrderStatus, PaymentStatus } from '../../generated/prisma/index.js';
import { prisma } from '../../lib/initiatePrisma';
import { zapUPIService } from '../services/zapupi.service';
import { smmService } from '../services/ssm.service';
import { telegramService } from '../services/telegram.service';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { ApiResponse } from '../types';
import { getPlatformNameFromUrl } from '../utils/platform.util';
// In-memory cache to rate-limit ZapUPI status checks (max once per 30s per order)
const zapupiCheckCache = new Map<string, number>();

import { getProviderForService, getCategoryForId, getServiceNameForId } from '../utils/smm.mapper';
import { validateLinkForService, ServiceCategory } from '../services/instagram.validator';

// ===================== Validation Schemas =====================

export const createOrderSchema = z.object({
    serviceId: z.number().int().positive('serviceId must be a positive integer'),
    link: z.string().optional().default(''),
    quantity: z.number().int().min(1, 'quantity must be at least 1'),
    amount: z.number().positive('amount must be positive'),
    serviceCategory: z.enum(['followers', 'likes', 'comments', 'views'], {
        errorMap: () => ({ message: 'serviceCategory must be one of: followers, likes, comments, views' }),
    }),
    customerMobile: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian mobile number').optional(),
    remark: z.string().max(200).optional(),
    userId: z.string().uuid().optional(),
});

export const validateLinkSchema = z.object({
    link: z.string().optional().default(''),
    serviceCategory: z.enum(['followers', 'likes', 'comments', 'views'], {
        errorMap: () => ({ message: 'serviceCategory must be one of: followers, likes, comments, views' }),
    }),
});

// ===================== Controllers =====================

// ===================== Controllers =====================

/**
 * POST /api/orders/validate-link
 * Validates an Instagram link against the selected service category.
 */
export async function validateLink(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { link, serviceCategory } = req.body as z.infer<typeof validateLinkSchema>;

        const result = validateLinkForService(link, serviceCategory as ServiceCategory);

        const response: ApiResponse = {
            success: result.valid,
            message: result.valid ? 'Link is valid for the selected service' : (result.error ?? 'Validation failed'),
            data: {
                linkType: result.linkType,
                valid: result.valid,
                allowedServices: result.allowedServices,
                platform: getPlatformNameFromUrl(link),
            },
        };

        res.status(result.valid ? 200 : 400).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/orders
 * Creates a new SMM order and triggers the ZapUPI payment flow.
 */
export async function createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const body = req.body as z.infer<typeof createOrderSchema>;
        let { serviceId, link, quantity, amount, serviceCategory, customerMobile, remark, userId } = body;

        // Derive meta-data from serviceId (Override or supplement frontend)
        const mappedCategory = getCategoryForId(serviceId);
        const mappedName = getServiceNameForId(serviceId);

        if (mappedCategory) {
            serviceCategory = mappedCategory;
        }

        const finalRemark = remark || (mappedName ? `${mappedName} - ${link}` : `${serviceCategory} - ${link}`);

        // Determine SMM provider based on serviceId
        const provider = getProviderForService(serviceId);

        // --- LINK VALIDATION (Strict Safety) ---
        const linkCheck = validateLinkForService(link, serviceCategory as ServiceCategory);
        if (!linkCheck.valid) {
            logger.warn(`[OrderController] Blocking order creation due to invalid link: ${linkCheck.error}`);
            res.status(400).json({
                success: false,
                message: linkCheck.error || 'Invalid link for the selected service',
                data: { linkType: linkCheck.linkType }
            });
            return;
        }

        // Create Order in DB
        const order = await prisma.order.create({
            data: {
                serviceId,
                link,
                quantity,
                amount,
                provider, // Track which panel handles this service
                remark: finalRemark,
                userId: userId ?? null,
                status: OrderStatus.PENDING,
            },
        });

        logger.info(`[OrderController] Created order: ${order.id} (Provider: ${provider}, Category: ${serviceCategory})`);

        // Create ZapUPI payment (alphanumeric only, no hyphens)
        const zapupiOrderId = `SMM${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;
        let paymentUrl: string | null = null;

        const redirectUrl = `${env.FRONTEND_URL}/payment/status?orderId=${order.id}`;

        const zapupiResponse = await zapUPIService.createOrder({
            amount,
            orderId: zapupiOrderId,
            customerMobile,
            redirectUrl,
            remark: `Instagram ${serviceCategory} - ${quantity} units`,
        });

        if (zapupiResponse.status === 'success' && zapupiResponse.payment_url) {
            paymentUrl = zapupiResponse.payment_url;

            await prisma.payment.create({
                data: {
                    zapupiOrderId,
                    orderId: order.id,
                    amount,
                    paymentUrl,
                    customerMobile: customerMobile ?? null,
                    status: PaymentStatus.PENDING,
                },
            });
        } else {
            logger.error(`[OrderController] ZapUPI payment creation failed for order ${order.id}:`, zapupiResponse);

            // Mark order as FAILED since payment couldn't be created
            await prisma.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.FAILED },
            });

            const failResponse: ApiResponse = {
                success: false,
                message: 'Payment gateway error — please try again',
                data: { orderId: order.id },
            };
            res.status(502).json(failResponse);
            return;
        }

        const response: ApiResponse = {
            success: true,
            message: 'Order created successfully',
            data: {
                orderId: order.id,
                serviceId: order.serviceId,
                link: order.link,
                quantity: order.quantity,
                amount: order.amount,
                status: order.status,
                serviceCategory,
                paymentUrl,
                zapupiOrderId,
                createdAt: order.createdAt,
            },
        };

        res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/orders/:id
 * Get full order details with payment and SMM order status.
 * Auto-syncs payment status from ZapUPI when payment is still PENDING (rate-limited to 30s).
 */
export async function getOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = String(req.params.id);

        const order = await prisma.order.findUnique({
            where: { id },
            include: { payment: true, smmOrder: true, user: true },
        });

        if (!order) {
            return next(createError('Order not found', 404));
        }

        // AUTO-SYNC: If payment is PENDING, check ZapUPI (rate-limited: once per 30s per order)
        if (order.payment && order.payment.status === 'PENDING') {
            const PAYMENT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
            const paymentAge = Date.now() - new Date(order.payment.createdAt).getTime();

            const cacheKey = `zapupi-check-${id}`;
            const lastCheck = zapupiCheckCache.get(cacheKey);
            const now = Date.now();
            const shouldCheck = !lastCheck || (now - lastCheck) > 30000;

            if (shouldCheck) {
                zapupiCheckCache.set(cacheKey, now);
                try {
                    const liveStatus = await zapUPIService.getOrderStatus(order.payment.zapupiOrderId);

                    if (liveStatus?.status === 'success' && liveStatus.data) {
                        const normalizedStatus = liveStatus.data.status?.toLowerCase();

                        if (normalizedStatus === 'success') {
                            logger.info(`[OrderController] Auto-syncing payment to SUCCESS for order ${id}`);

                            await prisma.payment.update({
                                where: { id: order.payment.id },
                                data: {
                                    status: 'SUCCESS',
                                    utr: liveStatus.data.utr || null,
                                    zapupiTxnId: liveStatus.data.txn_id || null,
                                },
                            });

                            await prisma.order.update({
                                where: { id },
                                data: { status: 'PROCESSING' },
                            });

                            // Publish to RabbitMQ — worker handles SMM order placement (async)
                            try {
                                await rabbitMQService.publishToQueue(QUEUES.PAYMENT_SUCCESS, {
                                    orderId: id,
                                    paymentId: order.payment.id,
                                    serviceId: order.serviceId,
                                    link: order.link,
                                    quantity: order.quantity,
                                    amount: order.payment.amount,
                                    utr: liveStatus.data.utr || null,
                                    timestamp: new Date().toISOString(),
                                });
                                logger.info(`[OrderController] Published PAYMENT_SUCCESS for order ${id}`);
                            } catch (mqErr) {
                                logger.error('[OrderController] RabbitMQ publish failed:', mqErr);
                            }

                            // Remove from cache since payment is no longer PENDING
                            zapupiCheckCache.delete(cacheKey);

                            const updated = await prisma.order.findUnique({
                                where: { id },
                                include: { payment: true, smmOrder: true, user: true },
                            });
                            res.json({ success: true, message: 'Order retrieved (payment synced)', data: updated });
                            return;

                        } else if (normalizedStatus === 'failed') {
                            logger.info(`[OrderController] Auto-syncing payment to FAILED for order ${id}`);

                            await prisma.payment.update({
                                where: { id: order.payment.id },
                                data: { status: 'FAILED', failureReason: 'Payment failed on ZapUPI' },
                            });

                            await prisma.order.update({
                                where: { id },
                                data: { status: 'FAILED' },
                            });

                            zapupiCheckCache.delete(cacheKey);

                            const updated = await prisma.order.findUnique({
                                where: { id },
                                include: { payment: true, smmOrder: true, user: true },
                            });
                            res.json({ success: true, message: 'Order retrieved (payment failed)', data: updated });
                            return;
                        }
                        // If ZapUPI status is still 'pending', check if payment has expired (>5 min)
                        if (paymentAge > PAYMENT_EXPIRY_MS) {
                            logger.info(`[OrderController] Payment expired (${Math.round(paymentAge / 1000)}s old) for order ${id}, auto-failing`);

                            await prisma.payment.update({
                                where: { id: order.payment.id },
                                data: { status: 'FAILED', failureReason: 'Payment expired (5 min timeout)' },
                            });

                            await prisma.order.update({
                                where: { id },
                                data: { status: 'FAILED' },
                            });

                            zapupiCheckCache.delete(cacheKey);

                            const updated = await prisma.order.findUnique({
                                where: { id },
                                include: { payment: true, smmOrder: true, user: true },
                            });
                            res.json({ success: true, message: 'Payment expired', data: updated });
                            return;
                        }
                        // Otherwise still pending within timeout, fall through
                    }
                } catch (syncErr) {
                    logger.warn(`[OrderController] ZapUPI status check failed for order ${id}:`, syncErr);
                }
            }
        }

        // Default: return order as-is
        res.json({ success: true, message: 'Order retrieved', data: order });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/orders
 * Get all orders (admin), with pagination.
 */
export async function getOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const page = parseInt(String(req.query.page ?? '1'), 10);
        const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
        const skip = (page - 1) * limit;
        const statusQuery = req.query.status as string | undefined;
        const status = statusQuery as OrderStatus | undefined;

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where: status ? { status } : undefined,
                include: { payment: true, smmOrder: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.order.count({ where: status ? { status } : undefined }),
        ]);

        const response: ApiResponse = {
            success: true,
            message: 'Orders retrieved',
            data: {
                orders,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            },
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

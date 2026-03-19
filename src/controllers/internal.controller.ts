import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/initiatePrisma';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';
import { OrderStatus, PaymentStatus } from '../../generated/prisma/index';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { getProviderForService, getCategoryForId, getServiceNameForId } from '../utils/smm.mapper';

/**
 * GET /api/internal/reports/collection
 * Aggregates revenue, bot orders, and SMM spend for a date range.
 */
export async function getCollectionReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const range = (req.query.range as string) || 'today';
        
        // Calculate date range in IST (consistent with the bot logic)
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now.getTime() + istOffset);

        let startDate: Date;
        let endDate: Date;

        if (range === 'today') {
            const istMidnight = new Date(istNow);
            istMidnight.setUTCHours(0, 0, 0, 0);
            startDate = new Date(istMidnight.getTime() - istOffset);
            endDate = now;
        } else if (range === 'yesterday') {
            const istYesterday = new Date(istNow);
            istYesterday.setUTCDate(istYesterday.getUTCDate() - 1);
            const istYesterdayMidnight = new Date(istYesterday);
            istYesterdayMidnight.setUTCHours(0, 0, 0, 0);
            startDate = new Date(istYesterdayMidnight.getTime() - istOffset);

            const istTodayMidnight = new Date(istNow);
            istTodayMidnight.setUTCHours(0, 0, 0, 0);
            endDate = new Date(istTodayMidnight.getTime() - istOffset);
        } else {
            res.status(400).json({ success: false, message: 'Invalid range' });
            return;
        }

        // Fetch orders with successful payments
        const ordersWithPayments = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lt: endDate },
                payment: { status: PaymentStatus.SUCCESS },
            },
            include: { payment: true, smmOrder: true },
        });

        // Fetch bot orders (no payment, but processing/completed)
        const botOrders = await prisma.order.findMany({
            where: {
                createdAt: { gte: startDate, lt: endDate },
                payment: null,
                status: { in: [OrderStatus.PROCESSING, OrderStatus.COMPLETED] },
            },
            include: { smmOrder: true },
        });

        const websiteRevenue = ordersWithPayments.reduce((sum, o) => sum + (o.payment?.amount ?? 0), 0);
        const totalSpend = [...ordersWithPayments, ...botOrders].reduce((sum, o) => sum + (o.smmOrder?.charge ?? 0), 0);
        const netProfit = websiteRevenue - totalSpend;

        const response: ApiResponse = {
            success: true,
            message: 'Report generated successfully',
            data: {
                range,
                startDate,
                endDate,
                websiteOrdersCount: ordersWithPayments.length,
                websiteRevenue,
                botOrdersCount: botOrders.length,
                totalSpend,
                netProfit,
            },
        };

        res.json(response);
    } catch (error) {
        logger.error('[InternalController] Error generating report:', error);
        next(error);
    }
}

/**
 * POST /api/internal/orders/bot
 * Places an order directly from the bot (free).
 */
const botOrderSchema = z.object({
    serviceId: z.number().int().positive(),
    link: z.string(),
    quantity: z.number().int().positive(),
    remark: z.string().optional(),
});

export async function createBotOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { serviceId, link, quantity, remark } = botOrderSchema.parse(req.body);

        const provider = getProviderForService(serviceId);
        const serviceName = getServiceNameForId(serviceId);
        const finalRemark = remark || (serviceName ? `${serviceName} - ${link}` : `Bot Order - ${link}`);

        // Create Order as PROCESSING (since it's pre-approved by bot admin)
        const order = await prisma.order.create({
            data: {
                serviceId,
                serviceName,
                link,
                quantity,
                amount: 0,
                provider,
                remark: finalRemark,
                status: OrderStatus.PROCESSING,
            },
        });

        // Trigger SMM placement worker via RabbitMQ
        await rabbitMQService.publishToQueue(QUEUES.PAYMENT_SUCCESS, {
            orderId: order.id,
            serviceId,
            link,
            quantity,
            amount: 0,
            utr: 'BOT_ORDER',
            timestamp: new Date().toISOString(),
        });

        logger.info(`[InternalController] Created bot order: ${order.id}`);

        res.status(201).json({
            success: true,
            message: 'Bot order created and queued for SMM',
            data: { orderId: order.id },
        });
    } catch (error) {
        logger.error('[InternalController] Error creating bot order:', error);
        next(error);
    }
}

/**
 * GET /api/internal/groups
 * List authorized groups.
 */
export async function getAuthorizedGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const groups = await prisma.approvedGroup.findMany({
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            message: 'Authorized groups retrieved',
            data: groups,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/internal/groups
 * Authorize/Update a group.
 */
const authorizeGroupSchema = z.object({
    chatId: z.string(),
    title: z.string().optional(),
});

export async function authorizeGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { chatId, title } = authorizeGroupSchema.parse(req.body);

        const group = await prisma.approvedGroup.upsert({
            where: { chatId },
            create: { chatId, title },
            update: { title },
        });

        res.json({
            success: true,
            message: 'Group authorized successfully',
            data: group,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/internal/groups/:chatId
 * De-authorize a group.
 */
export async function removeGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const chatId = String(req.params.chatId);

        await prisma.approvedGroup.delete({
            where: { chatId },
        });

        res.json({
            success: true,
            message: 'Group removed successfully',
        });
    } catch (error) {
        next(error);
    }
}

import { Request, Response, NextFunction } from 'express';
import { OrderStatus } from '../../generated/prisma/index.js';
import { smmService } from '../services/ssm.service';
import { prisma } from '../../lib/initiatePrisma';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

/**
 * GET /api/ssm/services
 * Fetch all available services from the SSM panel.
 */
export async function getServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const services = await smmService.getServices();

        const category = req.query.category as string | undefined;
        const filtered = category
            ? services.filter(s => s.category.toLowerCase().includes(category.toLowerCase()))
            : services;

        const response: ApiResponse = {
            success: true,
            message: `${filtered.length} services found`,
            data: filtered,
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/ssm/balance
 * Check the SMM panel account balance.
 */
export async function getBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const balance = await smmService.getBalance();

        const response: ApiResponse = {
            success: true,
            message: 'Balance retrieved',
            data: balance,
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/ssm/orders/:smmOrderId/status
 * Check live status of an SMM order from the panel and sync to DB.
 */
export async function getSmmOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const smmOrderId = String(req.params.smmOrderId);

        const liveStatus = await smmService.getOrderStatus(smmOrderId);

        // Sync status back to local DB
        try {
            const smmOrderRecord = await prisma.smmOrder.findFirst({
                where: { smmOrderId },
            });

            if (smmOrderRecord && liveStatus.status) {
                const statusMap: Record<string, OrderStatus> = {
                    'Completed': OrderStatus.COMPLETED,
                    'In progress': OrderStatus.PROCESSING,
                    'Partial': OrderStatus.PARTIAL,
                    'Processing': OrderStatus.PROCESSING,
                    'Cancelled': OrderStatus.CANCELLED,
                };

                const dbStatus = statusMap[liveStatus.status] ?? smmOrderRecord.status;

                await prisma.smmOrder.update({
                    where: { id: smmOrderRecord.id },
                    data: {
                        status: dbStatus,
                        startCount: liveStatus.start_count ? parseInt(liveStatus.start_count, 10) : undefined,
                        remains: liveStatus.remains ? parseInt(liveStatus.remains, 10) : undefined,
                    },
                });

                logger.info(`[SsmController] Updated DB status for SMM order ${smmOrderId} to ${dbStatus}`);
            }
        } catch (dbErr) {
            logger.warn(`[SsmController] Could not sync DB status for SMM order ${smmOrderId}:`, dbErr);
        }

        const response: ApiResponse = {
            success: true,
            message: 'SSM order status retrieved',
            data: liveStatus,
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

import { Request, Response, NextFunction } from 'express';
import { OrderStatus } from '../../generated/prisma/index.js';
import { smmService, supportiveSmmService, indSmmService, getSmmService } from '../services/ssm.service';
import { prisma } from '../../lib/initiatePrisma';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

/**
 * Resolve the correct SMM service instance from a query param.
 * ?panel=IND_SMM → IND, anything else → Supportive (default)
 */
function resolveSmmService(req: Request) {
    const panel = (req.query.panel as string || '').toUpperCase();
    if (panel === 'IND' || panel === 'IND_SMM') return indSmmService;
    return supportiveSmmService;
}

/**
 * GET /api/ssm/services
 * Fetch all available services from the SSM panel.
 */
export async function getServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const service = resolveSmmService(req);
        const services = await service.getServices();

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
        const service = resolveSmmService(req);
        const balance = await service.getBalance();

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

        // Find the record to know which provider to use
        const smmOrderRecord = await prisma.smmOrder.findFirst({
            where: { smmOrderId },
        });

        if (!smmOrderRecord) {
            throw createError('SMM order record not found in local DB', 404);
        }

        const service = getSmmService(smmOrderRecord.provider);
        const liveStatus = await service.getOrderStatus(smmOrderId);

        // Sync status back to local DB
        try {
            if (liveStatus.status) {
                const statusMap: Record<string, OrderStatus> = {
                    'Completed': OrderStatus.COMPLETED,
                    'In progress': OrderStatus.PROCESSING,
                    'Partial': OrderStatus.PARTIAL,
                    'Processing': OrderStatus.PROCESSING,
                    'Cancelled': OrderStatus.CANCELLED,
                };

                const dbStatus = statusMap[liveStatus.status] || OrderStatus.PENDING;

                await prisma.smmOrder.update({
                    where: { id: smmOrderRecord.id },
                    data: {
                        status: dbStatus,
                        charge: liveStatus.charge ? parseFloat(liveStatus.charge) : undefined,
                        remains: liveStatus.remains ? parseInt(liveStatus.remains) : undefined,
                        startCount: liveStatus.start_count ? parseInt(liveStatus.start_count) : undefined,
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

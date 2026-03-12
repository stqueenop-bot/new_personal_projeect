import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/initiatePrisma';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

const createOfferSchema = z.object({
    serviceSlug: z.string().min(1),
    title: z.string().min(1),
    badge: z.string().default('LIVE'),
    active: z.boolean().default(true),
    description: z.string().optional(),
    serviceId: z.number().int().positive().optional(),
    quantity: z.number().int().positive().optional(),
    price: z.number().positive().optional(),
}).strict();

/**
 * GET /api/offers?service=instagram
 * Returns the active offer for a service, or null.
 */
export async function getOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const serviceSlug = req.query.service as string;

        if (!serviceSlug) {
            const response: ApiResponse = {
                success: false,
                message: 'service query param is required',
            };
            res.status(400).json(response);
            return;
        }

        const offer = await prisma.specialOffer.findFirst({
            where: { serviceSlug, active: true },
        });

        const response: ApiResponse = {
            success: true,
            message: offer ? 'Offer found' : 'No active offer',
            data: offer,
        };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/offers/all
 * Returns all offers (admin).
 */
export async function getAllOffers(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const offers = await prisma.specialOffer.findMany({
            orderBy: { createdAt: 'desc' },
        });

        const response: ApiResponse = {
            success: true,
            message: 'All offers retrieved',
            data: offers,
        };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/offers
 * Create a new offer. If active=true, deactivates existing active offer for that service first.
 */
export async function createOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = req.body;

        // If activating a new offer, deactivate the old one for this service
        if (data.active) {
            await prisma.specialOffer.updateMany({
                where: { serviceSlug: data.serviceSlug, active: true },
                data: { active: false },
            });
            logger.info(`[OfferController] Deactivated previous offers for ${data.serviceSlug}`);
        }

        const offer = await prisma.specialOffer.create({ data: { ...data, serviceSlug: data.serviceSlug } });

        logger.info(`[OfferController] Created offer: ${offer.id} for ${offer.serviceSlug}`);

        const response: ApiResponse = {
            success: true,
            message: 'Offer created',
            data: offer,
        };
        res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/offers/:id
 * Deactivate an offer.
 */
export async function deleteOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = String(req.params.id);

        await prisma.specialOffer.update({
            where: { id },
            data: { active: false },
        });

        logger.info(`[OfferController] Deactivated offer: ${id}`);

        const response: ApiResponse = {
            success: true,
            message: 'Offer deactivated',
        };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

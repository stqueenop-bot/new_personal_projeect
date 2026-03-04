import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/initiatePrisma';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

const createBannerSchema = z.object({
    title: z.string().min(1),
    subtitle: z.string().min(1),
    buttonText: z.string().min(1),
    buttonLink: z.string().min(1),
    imageUrl: z.string().url().optional(),
    backgroundColor: z.string().default('from-orange-400 to-orange-600'),
    sortOrder: z.number().int().default(0),
    active: z.boolean().default(true),
});

const updateBannerSchema = createBannerSchema.partial();

/**
 * GET /api/banners
 * Returns all active banners, sorted by sortOrder.
 */
export async function getBanners(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const banners = await prisma.banner.findMany({
            where: { active: true },
            orderBy: { sortOrder: 'asc' },
        });

        const response: ApiResponse = {
            success: true,
            message: 'Banners retrieved',
            data: banners,
        };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/banners
 * Create a new banner.
 */
export async function createBanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = createBannerSchema.parse(req.body);

        const banner = await prisma.banner.create({ data });

        logger.info(`[BannerController] Created banner: ${banner.id}`);

        const response: ApiResponse = {
            success: true,
            message: 'Banner created',
            data: banner,
        };
        res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * PATCH /api/banners/:id
 * Update an existing banner.
 */
export async function updateBanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = String(req.params.id);
        const data = updateBannerSchema.parse(req.body);

        const banner = await prisma.banner.update({
            where: { id },
            data,
        });

        logger.info(`[BannerController] Updated banner: ${banner.id}`);

        const response: ApiResponse = {
            success: true,
            message: 'Banner updated',
            data: banner,
        };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/banners/:id
 * Soft-delete: sets active to false.
 */
export async function deleteBanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = String(req.params.id);

        await prisma.banner.update({
            where: { id },
            data: { active: false },
        });

        logger.info(`[BannerController] Deactivated banner: ${id}`);

        const response: ApiResponse = {
            success: true,
            message: 'Banner deactivated',
        };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

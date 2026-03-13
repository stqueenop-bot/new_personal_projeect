import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/initiatePrisma';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

const createBannerSchema = z.object({
    imageUrl: z.string().url(),
    active: z.boolean().default(true),
});

const updateBannerSchema = createBannerSchema.partial();

/** GET /api/banners — all active banners */
export async function getBanners(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const banners = await prisma.banner.findMany({
            where: { active: true },
            orderBy: { createdAt: 'asc' },
        });
        const response: ApiResponse = { success: true, message: 'Banners retrieved', data: banners };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/** GET /api/banners/all — all banners including inactive (admin) */
export async function getAllBanners(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const banners = await prisma.banner.findMany({
            orderBy: { createdAt: 'asc' },
        });
        const response: ApiResponse = { success: true, message: 'All banners retrieved', data: banners };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/** POST /api/banners — add a banner */
export async function createBanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = req.body;
        const banner = await prisma.banner.create({ data });
        logger.info(`[BannerController] Created banner: ${banner.id}`);
        const response: ApiResponse = { success: true, message: 'Banner created', data: banner };
        res.status(201).json(response);
    } catch (error) {
        next(error);
    }
}

/** PATCH /api/banners/:id — toggle active or update imageUrl */
export async function updateBanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = String(req.params.id);
        const data = updateBannerSchema.parse(req.body);
        const banner = await prisma.banner.update({ where: { id }, data });
        logger.info(`[BannerController] Updated banner: ${banner.id}`);
        const response: ApiResponse = { success: true, message: 'Banner updated', data: banner };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

/** DELETE /api/banners/:id — remove a banner */
export async function deleteBanner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = String(req.params.id);
        await prisma.banner.delete({ where: { id } });
        logger.info(`[BannerController] Deleted banner: ${id}`);
        const response: ApiResponse = { success: true, message: 'Banner deleted' };
        res.json(response);
    } catch (error) {
        next(error);
    }
}

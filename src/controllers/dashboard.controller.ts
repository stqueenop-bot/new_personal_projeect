import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/initiatePrisma';
import { ApiResponse } from '../types';

/**
 * GET /api/dashboard/stats
 * Returns key stats for the admin dashboard:
 *  - totalOrders
 *  - totalRevenue (sum of all SUCCESSFUL payments)
 *  - activeApis
 *  - telegramBots
 *  - recentOrders (last 10, with payment included)
 */
export async function getDashboardStats(
    _req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const [
            totalOrders,
            successPaymentsAgg,
            recentOrders,
            recentPayments,
        ] = await Promise.all([
            // Total orders ever created
            prisma.order.count(),

            // Sum of all successful payments (this is the real "money earned")
            prisma.payment.aggregate({
                _sum: { amount: true },
                where: { status: 'SUCCESS' },
            }),

            // Last 10 orders that were actually PAID (for collection collection)
            prisma.order.findMany({
                where: {
                    payment: { status: 'SUCCESS' }
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
                include: { payment: true, smmOrder: true },
            }),

            // Last 10 successful payments (detailed collection log)
            prisma.payment.findMany({
                where: { status: 'SUCCESS' },
                orderBy: { updatedAt: 'desc' },
                take: 10,
                include: { order: true },
            }),
        ]);

        const totalRevenue = successPaymentsAgg._sum.amount ?? 0;

        const response: ApiResponse = {
            success: true,
            message: 'Dashboard stats retrieved',
            data: {
                totalOrders,
                totalRevenue,
                // Static counts for now — expand as the system grows
                activeApis: 2,   // Supportive SMM + IND SMM
                telegramBots: 2, // Main bot + Failed-orders bot
                recentOrders,
                recentPayments,
            },
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
}

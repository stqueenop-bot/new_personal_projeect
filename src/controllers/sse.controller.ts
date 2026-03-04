import { Request, Response } from 'express';
import { sseService } from '../services/sse.service';
import { logger } from '../utils/logger';

/**
 * GET /api/orders/:id/status
 * SSE endpoint for real-time order status updates.
 */
export async function subscribeToOrderStatus(req: Request, res: Response): Promise<void> {
    const orderId = String(req.params.id);

    if (!orderId) {
        res.status(400).json({ success: false, message: 'Order ID is required' });
        return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    logger.info(`[SSEController] New subscription for order: ${orderId}`);

    // Register client
    sseService.addClient(orderId, res);

    // Send initial keep-alive/heartbeat
    res.write('retry: 10000\n\n');
}

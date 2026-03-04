import { Response } from 'express';
import { logger } from '../utils/logger';

/**
 * Server-Sent Events (SSE) Service
 * Manages active client connections and broadcasts updates.
 */
class SSEService {
    private clients: Map<string, Response[]> = new Map();

    /**
     * Add a client to listen for updates on a specific order.
     */
    addClient(orderId: string, res: Response): void {
        const clients = this.clients.get(orderId) || [];
        clients.push(res);
        this.clients.set(orderId, clients);

        logger.info(`[SSE] Client connected for order: ${orderId}. Total clients for this order: ${clients.length}`);

        // Remove client on connection close
        res.on('close', () => {
            this.removeClient(orderId, res);
        });
    }

    /**
     * Remove a client connection.
     */
    private removeClient(orderId: string, res: Response): void {
        const clients = this.clients.get(orderId);
        if (clients) {
            const filteredClients = clients.filter(client => client !== res);
            if (filteredClients.length > 0) {
                this.clients.set(orderId, filteredClients);
            } else {
                this.clients.delete(orderId);
            }
            logger.info(`[SSE] Client disconnected for order: ${orderId}`);
        }
    }

    /**
     * Broadcast an update to all clients listening for a specific order.
     */
    broadcastStatus(orderId: string, status: string, data?: any): void {
        const clients = this.clients.get(orderId);
        if (clients) {
            const payload = JSON.stringify({ orderId, status, ...data });
            logger.info(`[SSE] Broadcasting status update for order ${orderId}: ${status}`);

            clients.forEach(res => {
                res.write(`data: ${payload}\n\n`);
            });
        }
    }

    /**
     * Get total active connections across all orders.
     */
    getActiveConnectionCount(): number {
        let count = 0;
        this.clients.forEach(clients => {
            count += clients.length;
        });
        return count;
    }
}

export const sseService = new SSEService();

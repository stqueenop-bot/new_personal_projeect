import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
    SmmService,
    SmmAddOrderResponse,
    SmmOrderStatusResponse,
    SmmBalanceResponse,
} from '../types';

/**
 * Supportive SSM Panel Service
 * Integrates with generic SMM panel API (v2 standard).
 * You only need to set SSM_API_KEY and SSM_API_URL in .env.
 */
class SmmService_Class {
    private readonly apiUrl: string;
    private readonly apiKey: string;

    constructor() {
        this.apiUrl = env.SSM_API_URL;
        this.apiKey = env.SSM_API_KEY;
    }

    /**
     * Generic helper to post to the SSM panel API.
     */
    private async post<T>(params: Record<string, string | number>): Promise<T> {
        const payload = new URLSearchParams({
            key: this.apiKey,
            ...Object.entries(params).reduce(
                (acc, [k, v]) => ({ ...acc, [k]: String(v) }),
                {} as Record<string, string>
            ),
        });

        const response = await axios.post<T>(this.apiUrl, payload.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 20000,
        });

        return response.data;
    }

    /**
     * Fetch all available services from the panel.
     */
    async getServices(): Promise<SmmService[]> {
        try {
            logger.info('[SSM] Fetching service list...');
            const services = await this.post<SmmService[]>({ action: 'services' });
            logger.info(`[SSM] Fetched ${services.length} services`);
            return services;
        } catch (error) {
            logger.error('[SSM] Failed to fetch services:', error);
            throw new Error(`SSM getServices failed: ${(error as Error).message}`);
        }
    }

    /**
     * Place an order on the SMM panel.
     * @returns the SSM panel order ID
     */
    async placeOrder(params: {
        serviceId: number;
        link: string;
        quantity: number;
        runs?: number;
        interval?: number;
    }): Promise<number> {
        try {
            logger.info(`[SSM] Placing order: service=${params.serviceId}, link=${params.link}, qty=${params.quantity}`);

            const payload: Record<string, string | number> = {
                action: 'add',
                service: params.serviceId,
                link: params.link,
                quantity: params.quantity,
            };

            if (params.runs) payload.runs = params.runs;
            if (params.interval) payload.interval = params.interval;

            const response = await this.post<SmmAddOrderResponse>(payload);

            if (response.error) {
                throw new Error(response.error);
            }

            if (!response.order) {
                throw new Error('SSM panel returned no order ID');
            }

            logger.success(`[SSM] Order placed successfully. SMM Order ID: ${response.order}`);
            return response.order;
        } catch (error) {
            logger.error('[SSM] Failed to place order:', error);
            throw new Error(`SSM placeOrder failed: ${(error as Error).message}`);
        }
    }

    /**
     * Get the status of an existing SSM order.
     */
    async getOrderStatus(smmOrderId: string | number): Promise<SmmOrderStatusResponse> {
        try {
            logger.info(`[SSM] Checking order status: ${smmOrderId}`);

            const response = await this.post<SmmOrderStatusResponse>({
                action: 'status',
                order: smmOrderId,
            });

            if (response.error) {
                throw new Error(response.error);
            }

            return response;
        } catch (error) {
            logger.error(`[SSM] Failed to get order status for ${smmOrderId}:`, error);
            throw new Error(`SSM getOrderStatus failed: ${(error as Error).message}`);
        }
    }

    /**
     * Get the current account balance on the SSM panel.
     */
    async getBalance(): Promise<{ balance: string; currency: string }> {
        try {
            logger.info('[SSM] Fetching balance...');

            const response = await this.post<SmmBalanceResponse>({ action: 'balance' });

            if (response.error) {
                throw new Error(response.error);
            }

            return {
                balance: response.balance ?? '0',
                currency: response.currency ?? 'USD',
            };
        } catch (error) {
            logger.error('[SSM] Failed to get balance:', error);
            throw new Error(`SSM getBalance failed: ${(error as Error).message}`);
        }
    }
}

export const smmService = new SmmService_Class();

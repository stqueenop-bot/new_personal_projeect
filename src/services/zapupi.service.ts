import axios from 'axios';
import qs from 'qs';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
    ZapUPICreateOrderResponse,
    ZapUPIOrderStatusResponse,
} from '../types';

/**
 * ZapUPI Payment Service
 * Handles creating UPI payment orders and checking their status.
 */
export class ZapUPIService {
    private readonly baseUrl: string;
    private readonly tokenKey: string;
    private readonly secretKey: string;

    constructor() {
        this.baseUrl = env.ZAPUPI_API_URL;
        this.tokenKey = env.ZAPUPI_TOKEN_KEY;
        this.secretKey = env.ZAPUPI_SECRET_KEY;
    }

    /**
     * Create a new UPI payment order on ZapUPI.
     * @returns payment_url to redirect user to for completing payment
     */
    async createOrder(params: {
        amount: number;
        orderId: string;
        customerMobile?: string;
        redirectUrl?: string;
        remark?: string;
    }): Promise<ZapUPICreateOrderResponse> {
        const MAX_RETRIES = 3;
        let lastError: any;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    logger.warn(`[ZapUPI] Retrying createOrder (Attempt ${attempt}/${MAX_RETRIES})...`);
                } else {
                    logger.info(`[ZapUPI] Creating order: ${params.orderId}, amount: ${params.amount}`);
                }

                const payload: Record<string, string | number> = {
                    token_key: this.tokenKey,
                    secret_key: this.secretKey,
                    amount: params.amount,
                    order_id: params.orderId,
                };

                if (params.customerMobile) payload.custumer_mobile = params.customerMobile;
                if (params.redirectUrl) payload.redirect_url = params.redirectUrl;
                if (params.remark) payload.remark = params.remark;

                const response = await axios.post<ZapUPICreateOrderResponse>(
                    `${this.baseUrl}/create-order`,
                    qs.stringify(payload),
                    {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 30000,
                    }
                );

                logger.info(`[ZapUPI] Order create response:`, response.data);
                return response.data;
            } catch (error) {
                lastError = error;
                const isTimeout = (error as any).code === 'ECONNABORTED' || (error as any).message?.includes('timeout');
                
                if (!isTimeout || attempt === MAX_RETRIES) {
                    logger.error(`[ZapUPI] Failed to create order (Final Attempt ${attempt}/${MAX_RETRIES}):`, error);
                    break;
                }
                
                logger.warn(`[ZapUPI] createOrder attempt ${attempt} timed out. Retrying...`);
                // Wait briefly before retrying (exponential backoff not strictly needed but good practice)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        throw new Error(`ZapUPI createOrder failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
    }

    /**
     * Check the status of an existing order.
     */
    async getOrderStatus(orderId: string): Promise<ZapUPIOrderStatusResponse> {
        const MAX_RETRIES = 3;
        let lastError: any;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    logger.warn(`[ZapUPI] Retrying getOrderStatus (Attempt ${attempt}/${MAX_RETRIES})...`);
                } else {
                    logger.info(`[ZapUPI] Checking status for order: ${orderId}`);
                }

                const payload = {
                    token_key: this.tokenKey,
                    secret_key: this.secretKey,
                    order_id: orderId,
                };

                const response = await axios.post<ZapUPIOrderStatusResponse>(
                    `${this.baseUrl}/order-status`,
                    qs.stringify(payload),
                    {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 30000,
                    }
                );

                logger.info(`[ZapUPI] Order status:`, response.data);
                return response.data;
            } catch (error) {
                lastError = error;
                const isTimeout = (error as any).code === 'ECONNABORTED' || (error as any).message?.includes('timeout');

                if (!isTimeout || attempt === MAX_RETRIES) {
                    logger.error(`[ZapUPI] Failed to get order status (Final Attempt ${attempt}/${MAX_RETRIES}):`, error);
                    break;
                }

                logger.warn(`[ZapUPI] getOrderStatus attempt ${attempt} timed out. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        throw new Error(`ZapUPI getOrderStatus failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
    }
}

export const zapUPIService = new ZapUPIService();

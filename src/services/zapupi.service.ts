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
        try {
            logger.info(`[ZapUPI] Creating order: ${params.orderId}, amount: ${params.amount}`);

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
                    timeout: 15000,
                }
            );

            logger.info(`[ZapUPI] Order create response:`, response.data);
            return response.data;
        } catch (error) {
            logger.error('[ZapUPI] Failed to create order:', error);
            throw new Error(`ZapUPI createOrder failed: ${(error as Error).message}`);
        }
    }

    /**
     * Check the status of an existing order.
     */
    async getOrderStatus(orderId: string): Promise<ZapUPIOrderStatusResponse> {
        try {
            logger.info(`[ZapUPI] Checking status for order: ${orderId}`);

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
                    timeout: 15000,
                }
            );

            logger.info(`[ZapUPI] Order status:`, response.data);
            return response.data;
        } catch (error) {
            logger.error('[ZapUPI] Failed to get order status:', error);
            throw new Error(`ZapUPI getOrderStatus failed: ${(error as Error).message}`);
        }
    }
}

export const zapUPIService = new ZapUPIService();

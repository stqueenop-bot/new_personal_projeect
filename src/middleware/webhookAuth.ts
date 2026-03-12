import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

/**
 * ZapUPI Webhook Authentication Middleware
 * 
 * Validates incoming webhooks using multiple security layers:
 * 1. HMAC signature verification (if ZAPUPI_WEBHOOK_SECRET is set)
 * 2. IP whitelist (if ZAPUPI_WEBHOOK_IPS is set)
 * 
 * If neither is configured, the webhook endpoint is BLOCKED in production
 * to prevent unauthenticated webhook forgery.
 */

// Known ZapUPI IP ranges — update these from ZapUPI documentation
const ZAPUPI_KNOWN_IPS: string[] = [];

/**
 * Get the real client IP, accounting for proxies
 */
function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? '';
}

/**
 * Verify HMAC-SHA256 signature from ZapUPI
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
    const computed = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    // Use timing-safe comparison to prevent timing attacks
    try {
        return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
        return false;
    }
}

export function webhookAuth(req: Request, res: Response, next: NextFunction): void {
    const clientIp = getClientIp(req);
    const webhookSecret = env.ZAPUPI_WEBHOOK_SECRET;
    const webhookIps = env.ZAPUPI_WEBHOOK_IPS;

    logger.info(`[WebhookAuth] Incoming webhook from IP: ${clientIp}`);

    // ─── Layer 1: IP Whitelist ───
    if (webhookIps) {
        const allowedIps = webhookIps.split(',').map(ip => ip.trim()).filter(Boolean);
        if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
            logger.warn(`[WebhookAuth] BLOCKED — IP ${clientIp} not in whitelist: ${allowedIps.join(', ')}`);
            const response: ApiResponse = { success: false, message: 'Forbidden' };
            res.status(403).json(response);
            return;
        }
        logger.info(`[WebhookAuth] IP ${clientIp} is whitelisted ✓`);
    }

    // ─── Layer 2: HMAC Signature Verification ───
    if (webhookSecret) {
        const signature = req.headers['x-zapupi-signature'] as string
            ?? req.headers['x-webhook-signature'] as string
            ?? req.headers['signature'] as string;

        if (!signature) {
            logger.warn(`[WebhookAuth] BLOCKED — No signature header from IP: ${clientIp}`);
            const response: ApiResponse = { success: false, message: 'Missing webhook signature' };
            res.status(401).json(response);
            return;
        }

        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (!verifySignature(rawBody, signature, webhookSecret)) {
            logger.warn(`[WebhookAuth] BLOCKED — Invalid signature from IP: ${clientIp}`);
            const response: ApiResponse = { success: false, message: 'Invalid webhook signature' };
            res.status(401).json(response);
            return;
        }

        logger.info(`[WebhookAuth] Signature verified ✓`);
    }

    // ─── Safety Net: Block unprotected webhooks in production ───
    if (!webhookSecret && !webhookIps) {
        if (env.NODE_ENV === 'production') {
            logger.error(`[WebhookAuth] CRITICAL — Webhook endpoint is UNPROTECTED in production! Set ZAPUPI_WEBHOOK_SECRET or ZAPUPI_WEBHOOK_IPS.`);
            const response: ApiResponse = { success: false, message: 'Webhook authentication not configured' };
            res.status(503).json(response);
            return;
        }
        // In development, allow but warn loudly
        logger.warn(`[WebhookAuth] ⚠️  Webhook auth is NOT configured — allowing in dev mode only`);
    }

    next();
}

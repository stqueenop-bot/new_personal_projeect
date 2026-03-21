import { Router } from 'express';
import {
    createPayment,
    handleWebhook,
    getPaymentStatus,
    createPaymentSchema,
    webhookSchema,
} from '../controllers/payment.controller';
import { validate } from '../middleware/validate';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { webhookAuth } from '../middleware/webhookAuth';
import { paymentCreationLimiter } from '../middleware/rateLimiter';

const router = Router();

/**
 * POST /api/payments/create
 * Create a ZapUPI payment order for an existing order.
 * Protected by API key auth.
 */
router.post('/create', paymentCreationLimiter, apiKeyAuth, validate(createPaymentSchema), createPayment);

/**
 * POST /api/payments/webhook
 * ZapUPI payment callback endpoint.
 * Protected by webhook signature/IP verification.
 */
router.post('/webhook', webhookAuth, validate(webhookSchema), handleWebhook);

/**
 * GET /api/payments/status/:orderId
 * Check live payment status.
 * Protected by API key auth.
 */
router.get('/status/:orderId', apiKeyAuth, getPaymentStatus);

export default router;

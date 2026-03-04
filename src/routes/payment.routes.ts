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

const router = Router();

/**
 * POST /api/payments/create
 * Create a ZapUPI payment order for an existing order.
 * Protected by API key auth.
 */
router.post('/create', apiKeyAuth, validate(createPaymentSchema), createPayment);

/**
 * POST /api/payments/webhook
 * ZapUPI payment callback endpoint.
 * NOT protected (ZapUPI must be able to call this).
 */
router.post('/webhook', validate(webhookSchema), handleWebhook);

/**
 * GET /api/payments/status/:orderId
 * Check live payment status.
 * Protected by API key auth.
 */
router.get('/status/:orderId', apiKeyAuth, getPaymentStatus);

export default router;

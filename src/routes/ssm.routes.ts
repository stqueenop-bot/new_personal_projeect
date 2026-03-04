import { Router } from 'express';
import { getServices, getBalance, getSmmOrderStatus } from '../controllers/ssm.controller';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

/**
 * GET /api/ssm/services
 * List available SMM services. Optionally filter by ?category=Instagram
 */
router.get('/services', apiKeyAuth, getServices);

/**
 * GET /api/ssm/balance
 * Check SMM panel balance.
 */
router.get('/balance', apiKeyAuth, getBalance);

/**
 * GET /api/ssm/orders/:smmOrderId/status
 * Check live SSM order status and sync to DB.
 */
router.get('/orders/:smmOrderId/status', apiKeyAuth, getSmmOrderStatus);

export default router;

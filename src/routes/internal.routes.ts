import { Router } from 'express';
import {
    getCollectionReport,
    createBotOrder,
    getAuthorizedGroups,
    authorizeGroup,
    removeGroup,
} from '../controllers/internal.controller';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

/**
 * All internal routes are protected by apiKeyAuth.
 * The bot should provide the API_AUTH_KEY in the 'x-api-key' header.
 */
router.use(apiKeyAuth);

/**
 * GET /api/internal/reports/collection
 * Fetch today/yesterday collection reports.
 */
router.get('/reports/collection', getCollectionReport);

/**
 * POST /api/internal/orders/bot
 * Place a direct order from the Telegram bot (free).
 */
router.post('/orders/bot', createBotOrder);

/**
 * GET /api/internal/groups
 * List all authorized Telegram groups.
 */
router.get('/groups', getAuthorizedGroups);

/**
 * POST /api/internal/groups
 * Add or update an authorized Telegram group.
 */
router.post('/groups', authorizeGroup);

/**
 * DELETE /api/internal/groups/:chatId
 * Remove an authorized Telegram group.
 */
router.delete('/groups/:chatId', removeGroup);

export default router;

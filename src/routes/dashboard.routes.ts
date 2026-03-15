import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

/**
 * GET /api/dashboard/stats
 * Admin dashboard stats (admin only).
 */
router.get('/stats', apiKeyAuth, getDashboardStats);

export default router;

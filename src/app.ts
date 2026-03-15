import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler';
import { cloudflareOnly } from './middleware/cloudflareOnly';
import {
    globalRateLimiter,
    apiRateLimiter,
    sensitiveRateLimiter,
    webhookRateLimiter,
} from './middleware/rateLimiter';
import paymentRoutes from './routes/payment.routes';
import orderRoutes from './routes/order.routes';
import ssmRoutes from './routes/ssm.routes';
import bannerRoutes from './routes/banner.routes';
import offerRoutes from './routes/offer.routes';
import { ApiResponse } from './types';

const app = express();

// Trust Render's (and proxies') X-Forwarded-For header so rate limiters
// see the real client IP instead of Render's internal load balancer IP.
app.set('trust proxy', 1);

// ========================
// Security Middleware
// ========================
app.use(helmet());

// ========================
// Cloudflare Guard — block direct Render URL access
// ========================
// Rejects requests that don't carry Cloudflare's CF-Connecting-IP header.
// Only active in production; dev traffic passes through freely.
app.use(cloudflareOnly);

// ========================
// Global DDoS / Rate Limiting
// ========================
// Applied first — before any parsing or routing — to drop floods early.
app.use(globalRateLimiter);
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ========================
// Request Parsing
// ========================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ========================
// Logging
// ========================
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ========================
// Health Check
// ========================
app.get('/health', (_req, res) => {
    console.log(`[${new Date().toISOString()}] Health check requested`);
    const response: ApiResponse = {
        success: true,
        message: 'Server is healthy',
        data: {
            status: 'ok',
            environment: process.env.NODE_ENV,
            timestamp: new Date().toISOString(),
        },
    };
    res.json(response);
});

// ========================
// API Routes
// ========================
import { subscribeToOrderStatus } from './controllers/sse.controller';
// Sensitive endpoints: orders & payments — tight limit (20 req / 10 min)
app.use('/api/payments', webhookRateLimiter, paymentRoutes);
app.use('/api/orders', sensitiveRateLimiter, orderRoutes);
// General API — moderate limit (60 req / min)
app.use('/api/ssm', apiRateLimiter, ssmRoutes);
app.use('/api/banners', apiRateLimiter, bannerRoutes);
app.use('/api/offers', apiRateLimiter, offerRoutes);
app.get('/api/status/stream/:id', subscribeToOrderStatus);


// ========================
// 404 Handler
// ========================
app.use((_req, res) => {
    const response: ApiResponse = {
        success: false,
        message: 'Route not found',
    };
    res.status(404).json(response);
});

// ========================
// Global Error Handler
// ========================
app.use(errorHandler);

export default app;

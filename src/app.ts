import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler';
import paymentRoutes from './routes/payment.routes';
import orderRoutes from './routes/order.routes';
import ssmRoutes from './routes/ssm.routes';
import bannerRoutes from './routes/banner.routes';
import offerRoutes from './routes/offer.routes';
import { ApiResponse } from './types';

const app = express();

// ========================
// Security Middleware
// ========================
app.use(helmet());
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
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ssm', ssmRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/offers', offerRoutes);
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

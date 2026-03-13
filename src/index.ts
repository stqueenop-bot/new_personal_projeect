import 'dotenv/config';
import app from './app';
import { env } from './config/env';
import { prisma } from '../lib/initiatePrisma';
import { rabbitMQService } from './services/rabbitmq.service';
import { startPaymentWorker } from './workers/payment.worker';
import { startNotificationWorker } from './workers/notification.worker';
import { logger } from './utils/logger';

const PORT = parseInt(env.PORT, 10);

async function main() {
    logger.info('🚀 Starting SMM ZapUPI Backend...');

    // ─── Production Security Checks ───
    if (env.NODE_ENV === 'production') {
        if (!env.API_AUTH_KEY) {
            logger.error('❌ FATAL: API_AUTH_KEY is not set. Refusing to start in production without API authentication.');
            process.exit(1);
        }
        if (!env.ZAPUPI_WEBHOOK_SECRET && !env.ZAPUPI_WEBHOOK_IPS) {
            logger.error('❌ FATAL: Neither ZAPUPI_WEBHOOK_SECRET nor ZAPUPI_WEBHOOK_IPS is set. Refusing to start in production without webhook protection.');
            process.exit(1);
        }
        logger.success('✅ Production security checks passed');
    }

    // 1. Connect to PostgreSQL via Prisma
    try {
        await prisma.$connect();
        logger.success('✅ PostgreSQL connected');
    } catch (error) {
        logger.error('❌ PostgreSQL connection failed:', error);
        process.exit(1);
    }

    // 2. Connect to RabbitMQ and start workers
    try {
        await startPaymentWorker();
        await startNotificationWorker();
        logger.success('✅ RabbitMQ workers started');
    } catch (error) {
        logger.error('❌ RabbitMQ connection failed:', error);
        logger.warn('⚠️  Server will start but processing may not work until RabbitMQ is available');
    }


    // 3. Start Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
        logger.success(`✅ Server running at http://0.0.0.0:${PORT}`);
        logger.info(`📋 API Docs:`);
        logger.info(`   POST http://localhost:${PORT}/api/orders          ← Create SMM order`);
        logger.info(`   POST http://localhost:${PORT}/api/payments/create ← Create ZapUPI payment`);
        logger.info(`   POST http://localhost:${PORT}/api/payments/webhook ← ZapUPI webhook`);
        logger.info(`   GET  http://localhost:${PORT}/api/ssm/services    ← List SMM services`);
        logger.info(`   GET  http://localhost:${PORT}/health              ← Health check`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.warn(`\n[${signal}] Shutting down gracefully...`);

        server.close(async () => {
            logger.info('Express server closed');
            await prisma.$disconnect();
            logger.info('PostgreSQL disconnected');
            await rabbitMQService.close();
            logger.info('RabbitMQ disconnected');
            process.exit(0);
        });

        // Force exit after 10 seconds
        setTimeout(() => {
            logger.error('Forced shutdown after 10s timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled Promise Rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        process.exit(1);
    });
}

main();

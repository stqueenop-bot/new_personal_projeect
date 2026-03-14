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
    // Log telegram config keys for debugging (don't log full secret values in production!)
    const maskValue = (value: string | undefined) =>
        value ? `${value.substring(0, 4)}...${value.slice(-4)}` : 'not set';
    logger.info('🔑 Telegram keys:');
    logger.info(`  TELEGRAM_BOT_TOKEN = ${env.TELEGRAM_BOT_TOKEN ? maskValue(env.TELEGRAM_BOT_TOKEN) : 'not set'}`);
    logger.info(`  TELEGRAM_FAILED_BOT_TOKEN = ${env.TELEGRAM_FAILED_BOT_TOKEN ? maskValue(env.TELEGRAM_FAILED_BOT_TOKEN) : 'not set'}`);
    logger.info(`  TELEGRAM_ADMIN_CHAT_ID = ${env.TELEGRAM_ADMIN_CHAT_ID ?? 'not set'}`);
    logger.info(`  TELEGRAM_FAILED_CHAT_ID = ${env.TELEGRAM_FAILED_CHAT_ID ?? 'not set'}`);
    // 1. Start Express server IMMEDIATELLY to satisfy health checks
    const server = app.listen(PORT, '0.0.0.0', () => {
        logger.success(`✅ Server running at http://0.0.0.0:${PORT}`);
        logger.info(`📋 API Docs:`);
        logger.info(`   POST http://localhost:${PORT}/api/orders          ← Create SMM order`);
        logger.info(`   GET  http://localhost:${PORT}/health              ← Health check`);
    });
    console.log(process.env.SSM_API_KEY);

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

    // 2. Connect to PostgreSQL via Prisma
    try {
        await prisma.$connect();
        logger.success('✅ PostgreSQL connected');
    } catch (error) {
        logger.error('❌ PostgreSQL connection failed:', error);
        // We don't exit here immediately to let the user see the error in logs via /health if we wanted to
    }

    // 3. Connect to RabbitMQ and start workers
    try {
        await startPaymentWorker();
        await startNotificationWorker();
        logger.success('✅ RabbitMQ workers started');
    } catch (error) {
        logger.error('❌ RabbitMQ connection failed:', error);
        logger.warn('⚠️  Server will start but processing may not work until RabbitMQ is available');
    }

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

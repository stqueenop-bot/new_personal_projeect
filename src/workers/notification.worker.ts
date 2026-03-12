import { ConsumeMessage } from 'amqplib';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { telegramService } from '../services/telegram.service';
import { logger } from '../utils/logger';

/**
 * Handles order-related notifications (Telegram).
 */
async function handleNotification(msg: ConsumeMessage): Promise<void> {
    try {
        const data = JSON.parse(msg.content.toString());
        const { type, payload } = data;

        logger.info(`[NotificationWorker] Processing notification: ${type} for order ${payload.orderId}`);

        switch (type) {
            case 'SUCCESS':
                await telegramService.notifyOrderSuccess(payload);
                break;
            case 'SMM_FAILED':
                await telegramService.notifySmmOrderFailed(payload);
                break;
            case 'PAYMENT_FAILED':
                await telegramService.notifyPaymentFailed(payload);
                break;
            default:
                logger.warn(`[NotificationWorker] Unknown notification type: ${type}`);
        }
    } catch (error) {
        logger.error('[NotificationWorker] Error processing message:', error);
        // We catch errors here to prevent worker crash
    }
}

/**
 * Start the notification worker.
 */
export async function startNotificationWorker(): Promise<void> {
    logger.info('[Worker] Starting notification worker...');

    // rabbitMQService.connect() is likely already called by index.ts or payment.worker.ts
    // but it's safe to ensure it's connected.
    if (!rabbitMQService.isConnected()) {
        await rabbitMQService.connect();
    }

    await rabbitMQService.consumeQueue(QUEUES.ORDER_NOTIFY, handleNotification, 5);

    logger.success('[Worker] Notification worker started.');
}

import amqplib, { Channel, ConfirmChannel } from 'amqplib';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const QUEUES = {
    PAYMENT_SUCCESS: 'payment_success',
    PAYMENT_FAILED: 'payment_failed',
    ORDER_NOTIFY: 'order_notify',
} as const;

type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;
type ConsumeMessage = amqplib.ConsumeMessage;

export type { ConsumeMessage };

/**
 * RabbitMQ Service
 * Manages connection, publishing, and consuming messages.
 */
class RabbitMQService {
    private connection: AmqpConnection | null = null;
    private channel: Channel | null = null;
    private reconnecting = false;

    async connect(): Promise<void> {
        try {
            logger.info('[RabbitMQ] Connecting to:', env.RABBITMQ_URL);
            this.connection = await amqplib.connect(env.RABBITMQ_URL);
            this.channel = await this.connection.createChannel();

            // Assert all queues as durable (survive broker restart)
            await this.channel.assertQueue(QUEUES.PAYMENT_SUCCESS, { durable: true });
            await this.channel.assertQueue(QUEUES.PAYMENT_FAILED, { durable: true });
            await this.channel.assertQueue(QUEUES.ORDER_NOTIFY, { durable: true });

            this.reconnecting = false;
            logger.success('[RabbitMQ] Connected and queues asserted');

            // Handle connection errors and close events
            (this.connection as unknown as NodeJS.EventEmitter).on('error', (err: Error) => {
                logger.error('[RabbitMQ] Connection error:', err.message);
                this.reconnect();
            });

            (this.connection as unknown as NodeJS.EventEmitter).on('close', () => {
                logger.warn('[RabbitMQ] Connection closed, reconnecting...');
                this.reconnect();
            });
        } catch (error) {
            logger.error('[RabbitMQ] Failed to connect:', error);
            throw error;
        }
    }

    private reconnect(): void {
        if (this.reconnecting) return;
        this.reconnecting = true;
        this.connection = null;
        this.channel = null;

        setTimeout(async () => {
            try {
                await this.connect();
            } catch {
                logger.error('[RabbitMQ] Reconnect failed, retrying in 5s...');
                this.reconnecting = false;
                this.reconnect();
            }
        }, 5000);
    }

    /**
     * Publish a message to a queue.
     */
    async publishToQueue(queue: string, message: object): Promise<boolean> {
        try {
            if (!this.channel) {
                throw new Error('RabbitMQ channel is not initialized');
            }

            const content = Buffer.from(JSON.stringify(message));
            const result = this.channel.sendToQueue(queue, content, {
                persistent: true,
                contentType: 'application/json',
                timestamp: Date.now(),
            });

            logger.info(`[RabbitMQ] Published to "${queue}":`, message);
            return result;
        } catch (error) {
            logger.error(`[RabbitMQ] Failed to publish to "${queue}":`, error);
            throw error;
        }
    }

    /**
     * Consume messages from a queue.
     */
    async consumeQueue(
        queue: string,
        handler: (message: ConsumeMessage) => Promise<void>,
        prefetchCount = 1
    ): Promise<void> {
        if (!this.channel) {
            throw new Error('RabbitMQ channel is not initialized');
        }

        const channel = this.channel;
        channel.prefetch(prefetchCount);

        await channel.consume(queue, async (msg) => {
            if (!msg) return;

            try {
                await handler(msg);
                channel.ack(msg);
            } catch (error) {
                logger.error(`[RabbitMQ] Error processing message from "${queue}":`, error);
                channel.nack(msg, false, false);
            }
        });

        logger.info(`[RabbitMQ] Started consuming from queue: "${queue}"`);
    }

    async close(): Promise<void> {
        try {
            await this.channel?.close();
            await (this.connection as unknown as { close(): Promise<void> })?.close();
            logger.info('[RabbitMQ] Connection closed gracefully');
        } catch (error) {
            logger.error('[RabbitMQ] Error closing connection:', error);
        }
    }

    isConnected(): boolean {
        return this.connection !== null && this.channel !== null;
    }
}

export const rabbitMQService = new RabbitMQService();

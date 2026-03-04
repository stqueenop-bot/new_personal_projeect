import { ConsumeMessage } from 'amqplib';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { smmService } from '../services/ssm.service';
import { telegramService } from '../services/telegram.service';
import { prisma } from '../../lib/initiatePrisma';
import { logger } from '../utils/logger';
import { sseService } from '../services/sse.service';
import { PaymentSuccessMessage, PaymentFailedMessage } from '../types';


/**
 * Handles a successful payment message from RabbitMQ.
 * Flow: Payment Success → Place SSM Order → Notify Telegram
 */
async function handlePaymentSuccess(msg: ConsumeMessage): Promise<void> {
    const data: PaymentSuccessMessage = JSON.parse(msg.content.toString());

    logger.info(`[Worker] Processing payment success for order: ${data.orderId}`);

    // 1. Update Payment status in DB
    await prisma.payment.update({
        where: { orderId: data.orderId },
        data: {
            status: PaymentStatus.SUCCESS,
            utr: data.utr,
        },
    });

    // 2. Update Order status to PROCESSING
    await prisma.order.update({
        where: { id: data.orderId },
        data: { status: OrderStatus.PROCESSING },
    });

    // 2.a Emit SSE status update
    sseService.broadcastStatus(data.orderId, OrderStatus.PROCESSING);


    // 3. Upsert SmmOrder record (pending)
    await prisma.smmOrder.upsert({
        where: { orderId: data.orderId },
        create: {
            orderId: data.orderId,
            serviceId: data.serviceId,
            link: data.link,
            quantity: data.quantity,
            status: OrderStatus.PENDING,
        },
        update: {
            status: OrderStatus.PENDING,
        },
    });

    try {
        const isLocal = process.env.NODE_ENV === 'development';

        if (isLocal) {
            // SKIP SSM in local dev — simulate a successful order
            const fakeSmmOrderId = `LOCAL-${Date.now()}`;
            logger.info(`[Worker] LOCAL MODE: Skipping SSM panel. Simulated order: ${fakeSmmOrderId}`);

            await prisma.smmOrder.update({
                where: { orderId: data.orderId },
                data: {
                    smmOrderId: fakeSmmOrderId,
                    status: OrderStatus.PROCESSING,
                },
            });

            // Mark order as completed
            await prisma.order.update({
                where: { id: data.orderId },
                data: { status: OrderStatus.COMPLETED },
            });

            sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED, { smmOrderId: fakeSmmOrderId });

            await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
                type: 'SUCCESS',
                payload: {
                    orderId: data.orderId,
                    serviceId: data.serviceId,
                    link: data.link,
                    quantity: data.quantity,
                    amount: data.amount,
                    utr: data.utr,
                    smmOrderId: fakeSmmOrderId,
                    customerMobile: data.customerMobile,
                }
            });

            logger.success(`[Worker] LOCAL MODE: Order ${data.orderId} completed (SSM skipped)`);
            return;
        }

        // PRODUCTION: Place real order on SSM panel
        const smmOrderId = await smmService.placeOrder({
            serviceId: data.serviceId,
            link: data.link,
            quantity: data.quantity,
        });

        // Optionally fetch charge
        let charge: number | undefined;
        try {
            const smmStatus = await smmService.getOrderStatus(smmOrderId);
            charge = smmStatus.charge ? parseFloat(smmStatus.charge) : undefined;
        } catch {
            logger.warn(`[Worker] Could not fetch SSM order charge for SMM order ${smmOrderId}`);
        }

        await prisma.smmOrder.update({
            where: { orderId: data.orderId },
            data: {
                smmOrderId: String(smmOrderId),
                status: OrderStatus.PROCESSING,
                charge,
            },
        });

        sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED, { smmOrderId });

        await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
            type: 'SUCCESS',
            payload: {
                orderId: data.orderId,
                serviceId: data.serviceId,
                link: data.link,
                quantity: data.quantity,
                amount: data.amount,
                utr: data.utr,
                smmOrderId,
                customerMobile: data.customerMobile,
            }
        });

        logger.success(`[Worker] Order ${data.orderId} placed on SSM panel. SMM Order ID: ${smmOrderId}`);
    } catch (smmError) {
        const errorMsg = (smmError as Error).message;
        logger.error(`[Worker] SMM order placement failed for ${data.orderId}:`, errorMsg);

        // Mark as FAILED and alert admin — payment was received but SMM failed!
        await prisma.smmOrder.update({
            where: { orderId: data.orderId },
            data: { status: OrderStatus.FAILED, errorMsg },
        });

        await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.FAILED },
        });

        // Emit SSE failure status update
        sseService.broadcastStatus(data.orderId, OrderStatus.FAILED, { error: errorMsg });

        await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
            type: 'SMM_FAILED',
            payload: {
                orderId: data.orderId,
                serviceId: data.serviceId,
                link: data.link,
                quantity: data.quantity,
                error: errorMsg,
            }
        });
    }
}

/**
 * Handles a failed payment message from RabbitMQ.
 * Flow: Payment Failed → Mark Order Failed → Notify Telegram
 */
async function handlePaymentFailed(msg: ConsumeMessage): Promise<void> {
    const data: PaymentFailedMessage = JSON.parse(msg.content.toString());

    logger.warn(`[Worker] Processing payment failure for order: ${data.orderId}`);

    await prisma.payment.update({
        where: { orderId: data.orderId },
        data: {
            status: PaymentStatus.FAILED,
            failureReason: data.reason,
        },
    });

    await prisma.order.update({
        where: { id: data.orderId },
        data: { status: OrderStatus.FAILED },
    });

    // Emit SSE failure status update
    sseService.broadcastStatus(data.orderId, OrderStatus.FAILED, { error: data.reason });


    await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
        type: 'PAYMENT_FAILED',
        payload: {
            orderId: data.orderId,
            amount: data.amount,
            reason: data.reason,
            customerMobile: data.customerMobile,
        }
    });

    logger.info(`[Worker] Payment failure handled for order: ${data.orderId}`);
}


/**
 * Start the payment worker — connects to RabbitMQ and starts consuming.
 */
export async function startPaymentWorker(): Promise<void> {
    logger.info('[Worker] Starting payment worker...');

    await rabbitMQService.connect();

    await rabbitMQService.consumeQueue(QUEUES.PAYMENT_SUCCESS, handlePaymentSuccess, 1);
    await rabbitMQService.consumeQueue(QUEUES.PAYMENT_FAILED, handlePaymentFailed, 2);

    logger.success('[Worker] Payment worker started. Listening for messages...');
}

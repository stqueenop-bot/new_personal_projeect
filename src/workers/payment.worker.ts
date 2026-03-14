import { ConsumeMessage } from 'amqplib';
import { OrderStatus, PaymentStatus, SmmProvider } from '../../generated/prisma/index.js';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service.js';
import { getSmmService } from '../services/ssm.service.js';
import { telegramService } from '../services/telegram.service.js';
import { prisma } from '../../lib/initiatePrisma.js';
import { logger } from '../utils/logger.js';
import { sseService } from '../services/sse.service.js';
import { PaymentSuccessMessage, PaymentFailedMessage } from '../types/index.js';
import { getProviderForService, getCategoryForId } from '../utils/smm.mapper.js';
import { validateLinkForService, ServiceCategory } from '../services/instagram.validator.js';



/**
 * Handles a successful payment message from RabbitMQ.
 *
 * Flow:
 *  - Non-Instagram orders → mark COMPLETED immediately (no SMM calls)
 *  - Instagram orders     → place SMM order, then validate link type
 *      → SMM success  → check link type validity → COMPLETED or admin-flagged
 *      → SMM failure  → user sees COMPLETED (payment ok), admin gets manual-order alert
 */
async function handlePaymentSuccess(msg: ConsumeMessage): Promise<void> {
    const data: PaymentSuccessMessage = JSON.parse(msg.content.toString());

    logger.info(`[Worker] Processing payment success for order: ${data.orderId}`);

    // Fetch full order to get the provider
    const order = await prisma.order.findUnique({
        where: { id: data.orderId }
    });

    if (!order) {
        logger.error(`[Worker] Order ${data.orderId} not found!`);
        return;
    }

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

    sseService.broadcastStatus(data.orderId, OrderStatus.PROCESSING);

    // ──────────────────────────────────────────────────────────
    // UNMAPPED SERVICES: Complete immediately, no SMM call needed
    // ──────────────────────────────────────────────────────────
    const serviceCategory = getCategoryForId(data.serviceId) as ServiceCategory | null;

    if (!serviceCategory) {
        logger.info(`[Worker] Unmapped service order ${data.orderId}. Bypassing SMM and marking COMPLETED directly.`);

        await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.COMPLETED },
        });

        sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED);

        await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
            type: 'SUCCESS',
            payload: {
                orderId: data.orderId,
                serviceId: data.serviceId,
                link: data.link,
                quantity: data.quantity,
                amount: data.amount,
                utr: data.utr,
                customerMobile: data.customerMobile,
                provider: 'UNMAPPED_MANUAL',
            }
        });

        logger.success(`[Worker] Unmapped service order ${data.orderId} completed.`);
        return;
    }

    // ──────────────────────────────────────────────────────────
    // MAPPED SERVICES: Place SMM order
    // ──────────────────────────────────────────────────────────
    const provider = order.provider as SmmProvider;
    const currentSmmService = getSmmService(provider);

    // Upsert SmmOrder record (pending)
    await prisma.smmOrder.upsert({
        where: { orderId: data.orderId },
        create: {
            orderId: data.orderId,
            serviceId: data.serviceId,
            provider,
            link: data.link,
            quantity: data.quantity,
            status: OrderStatus.PENDING,
        },
        update: {
            status: OrderStatus.PENDING,
            provider,
        },
    });

    try {
        // Place real order on the selected SMM panel
        const smmOrderId = await currentSmmService.placeOrder({
            serviceId: data.serviceId,
            link: data.link,
            quantity: data.quantity,
        });

        // Optionally fetch charge
        let charge: number | undefined;
        try {
            const smmStatus = await currentSmmService.getOrderStatus(smmOrderId);
            charge = smmStatus.charge ? parseFloat(smmStatus.charge) : undefined;
        } catch {
            logger.warn(`[Worker] Could not fetch SMM order charge for order ${smmOrderId}`);
        }

        await prisma.smmOrder.update({
            where: { orderId: data.orderId },
            data: {
                smmOrderId: String(smmOrderId),
                status: OrderStatus.PROCESSING,
                charge,
            },
        });

        // Post-SMM link validation (Feature 4)
        // Since we are here, serviceCategory is guaranteed to exist
        const linkCheck = validateLinkForService(data.link, serviceCategory);
        if (!linkCheck.valid) {
                // Mark order FAILED and alert admin — wrong link type for the mapped service
                logger.warn(`[Worker] Post-SMM link validation failed for order ${data.orderId}: ${linkCheck.error}`);

                await prisma.order.update({
                    where: { id: data.orderId },
                    data: { status: OrderStatus.FAILED },
                });

                sseService.broadcastStatus(data.orderId, OrderStatus.FAILED, { error: linkCheck.error });

                // Fire-and-forget: Telegram failure must NOT affect order status
                telegramService.notifyFailedOrderBot({
                    orderId: data.orderId,
                    serviceId: data.serviceId,
                    link: data.link,
                    quantity: data.quantity,
                    amount: data.amount,
                    utr: data.utr,
                    smmOrderId: String(smmOrderId),
                    error: `Wrong link type: ${linkCheck.error}`,
                    apiKey: currentSmmService.getApiKey(),
                }).catch(tgErr => logger.warn(`[Worker] Telegram notify failed (non-fatal):`, tgErr));
                return;
            }

        // All good — mark COMPLETED
        await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.COMPLETED },
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
                provider,
            }
        });

        logger.success(`[Worker] Order ${data.orderId} placed on ${provider} panel. SMM ID: ${smmOrderId}`);

    } catch (smmError) {
        const errorMsg = (smmError as Error).message;
        logger.error(`[Worker] ${provider} order placement failed for ${data.orderId}:`, errorMsg);

        // SMM failed BUT payment was received.
        // User sees SUCCESS (payment went through — we'll fix manually).
        // Admin is alerted on the failed-orders bot.

        await prisma.smmOrder.update({
            where: { orderId: data.orderId },
            data: { status: OrderStatus.FAILED, errorMsg },
        });

        // Mark order COMPLETED so user sees success in the UI
        await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.COMPLETED },
        });

        // Emit COMPLETED to frontend (payment was fine)
        sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED);

        // Alert admin on the failed-orders bot — fire-and-forget, must NOT affect order status
        telegramService.notifyFailedOrderBot({
            orderId: data.orderId,
            serviceId: data.serviceId,
            link: data.link,
            quantity: data.quantity,
            amount: data.amount,
            utr: data.utr,
            error: `SMM placement failed: ${errorMsg}`,
            apiKey: currentSmmService.getApiKey(),
        }).catch(tgErr => logger.warn(`[Worker] Telegram notify failed (non-fatal):`, tgErr));

        logger.warn(`[Worker] Order ${data.orderId}: user shown success, admin alerted for manual placement.`);
    }
}

/**
 * Handles a failed payment message from RabbitMQ.
 * Flow: Payment Failed → Mark Order Failed → Notify via ORDER_NOTIFY queue
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

import { ConsumeMessage } from 'amqplib';
import { OrderStatus, PaymentStatus, SmmProvider } from '../../generated/prisma/index';
import { rabbitMQService, QUEUES } from '../services/rabbitmq.service';
import { getSmmService } from '../services/ssm.service';
import { prisma } from '../../lib/initiatePrisma';
import { logger } from '../utils/logger';
import { sseService } from '../services/sse.service';
import { PaymentSuccessMessage, PaymentFailedMessage } from '../types/index';
import { getProviderForService, getCategoryForId, isValidQuantity } from '../utils/smm.mapper';
import { validateLinkForService, ServiceCategory } from '../services/instagram.validator';



/**
 * Handles a successful payment message from RabbitMQ.
 *
 * Flow:
 *  - Unmapped services → mark COMPLETED immediately (manual handling)
 *  - Mapped services:
 *      1. Validate link type BEFORE SMM call.
 *      2. If link invalid → skip SMM, show COMPLETED to user, alert admin for manual fix.
 *      3. If link valid   → place SMM order.
 *          → SMM success  → mark COMPLETED.
 *          → SMM failure  → show COMPLETED to user, alert admin for manual fix.
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

    // 2. Update Order status to PROCESSING (ONLY if it was PENDING)
    // This ensures that two workers don't start processing the same order concurrently.
    let orderData;
    try {
        orderData = await prisma.order.update({
            where: { id: data.orderId, status: OrderStatus.PENDING },
            data: { status: OrderStatus.PROCESSING },
            select: { serviceName: true, provider: true, status: true, remark: true }
        });
    } catch (updateErr: any) {
        // If record not found, it's either not PENDING or doesn't exist.
        // We check the current state to decide if we should skip.
        const currentOrder = await prisma.order.findUnique({
            where: { id: data.orderId },
            include: { smmOrder: true }
        });

        if (currentOrder?.status === OrderStatus.COMPLETED || currentOrder?.smmOrder?.smmOrderId) {
            logger.info(`[Worker] Order ${data.orderId} already processed (Status: ${currentOrder.status}). Skipping.`);
            return;
        }

        logger.error(`[Worker] Failed to transition order ${data.orderId} to PROCESSING: ${updateErr.message}`);
        return;
    }

    sseService.broadcastStatus(data.orderId, OrderStatus.PROCESSING);

    // ──────────────────────────────────────────────────────────
    // MAPPED SERVICES: Validation and SMM flow
    // ──────────────────────────────────────────────────────────
    const serviceCategory = getCategoryForId(data.serviceId) as ServiceCategory | null;
    // 1. Check if Service is Mapped and Quantity is Valid
    if (!serviceCategory || !isValidQuantity(data.serviceId, data.quantity)) {
        const reason = !serviceCategory
            ? `Unmapped service ID: ${data.serviceId}`
            : `Manual order required: Invalid quantity ${data.quantity} for service ${data.serviceId}`;

        logger.info(`[Worker] ${reason}. Bypassing SMM and marking COMPLETED directly.`);

        // Fetch service name from DB if available
        const order = await prisma.order.findUnique({
            where: { id: data.orderId },
            select: { serviceName: true }
        });

        const { serviceName } = await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.COMPLETED },
        });

        sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED);
        // If it's just an invalid quantity, send to SUCCESS bot (main bot) as requested
        // but with a flag that it was not placed on SMM.)
        if ((serviceName?.toLowerCase() !== 'instagram') || (serviceCategory && !isValidQuantity(data.serviceId, data.quantity))) {
            await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
                type: 'SUCCESS',
                payload: {
                    orderId: data.orderId,
                    serviceId: data.serviceId,
                    serviceName: order?.serviceName ?? undefined,
                    link: data.link,
                    quantity: data.quantity,
                    amount: data.amount,
                    utr: data.utr,
                    customerMobile: data.customerMobile,
                    provider: 'MANUAL_REQUIRED',
                    apiStatus: 'Order Not Placed'
                }
            });
        } else {
            // For truly unmapped services, route to failed bot for safety or keep as SMM_FAILED
            await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
                type: 'SMM_FAILED',
                payload: {
                    orderId: data.orderId,
                    serviceId: data.serviceId,
                    serviceName: order?.serviceName ?? undefined,
                    link: data.link,
                    quantity: data.quantity,
                    amount: data.amount,
                    utr: data.utr,
                    error: reason,
                    provider: 'MANUAL_REQUIRED',
                    apiStatus: 'Order Not Placed'
                }
            });
        }

        logger.success(`[Worker] Order ${data.orderId} skipped (manual required).`);
        return;
    }

    // ──────────────────────────────────────────────────────────
    // MAPPED SERVICES: Validation and SMM flow
    // ──────────────────────────────────────────────────────────
    const provider = orderData.provider as SmmProvider;
    const currentSmmService = getSmmService(provider);

    // 1. Check for Idempotency again: Double check if an SmmOrder already exists with an ID
    const existingSmmOrder = await prisma.smmOrder.findUnique({
        where: { orderId: data.orderId }
    });

    if (existingSmmOrder?.smmOrderId) {
        logger.info(`[Worker] Order ${data.orderId} already has an SMM order (${existingSmmOrder.smmOrderId}). Skipping duplicate placement.`);
        // Mark COMPLETED if it wasn't already (safety)
        if (order.status !== OrderStatus.COMPLETED) {
            await prisma.order.update({ where: { id: data.orderId }, data: { status: OrderStatus.COMPLETED } });
        }
        return;
    }

    // 3. Link Validation (MAJOR HOTFIX: Done BEFORE SMM call)
    const linkCheck = validateLinkForService(data.link, serviceCategory);
    if (!linkCheck.valid) {
        logger.warn(`[Worker] Link validation failed BEFORE SMM for order ${data.orderId}: ${linkCheck.error}`);

        // Mark order COMPLETED (not FAILED) so user sees success.
        // Payment was successful, so we will fix the link/order manually.
        await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.COMPLETED },
        });

        sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED);

        // Alert admin via RabbitMQ -> notification worker (non-blocking, reliable)
        await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
            type: 'SMM_FAILED',
            payload: {
                orderId: data.orderId,
                serviceId: data.serviceId,
                link: data.link,
                quantity: data.quantity,
                amount: data.amount,
                utr: data.utr,
                error: `Invalid Link Format: ${linkCheck.error} (SMM call skipped)`,
                provider,
            }
        });

        logger.warn(`[Worker] Order ${data.orderId}: Link invalid, skipping SMM, alert queued for admin.`);
        return;
    }

    // 4. Place SMM order (only if link is valid)
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
        const smmOrderId = await currentSmmService.placeOrder({
            serviceId: data.serviceId,
            link: data.link,
            quantity: data.quantity,
            comments: serviceCategory === 'comments' ? (orderData.remark || undefined) : undefined,
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
        // User sees SUCCESS, admin handles manually.
        await prisma.smmOrder.update({
            where: { orderId: data.orderId },
            data: { status: OrderStatus.FAILED, errorMsg },
        });

        await prisma.order.update({
            where: { id: data.orderId },
            data: { status: OrderStatus.COMPLETED },
        });

        sseService.broadcastStatus(data.orderId, OrderStatus.COMPLETED);

        // Alert admin via RabbitMQ -> notification worker (non-blocking, reliable)
        await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
            type: 'SMM_FAILED',
            payload: {
                orderId: data.orderId,
                serviceId: data.serviceId,
                link: data.link,
                quantity: data.quantity,
                amount: data.amount,
                utr: data.utr,
                error: `SMM placement failed: ${errorMsg}`,
                provider,
            }
        });
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

    // ─── TELEGRAM NOTIFICATION ───
    // Only notify if it's NOT a timeout/expiration
    const isExpiry = data.reason?.toLowerCase().includes('timeout') ||
        data.reason?.toLowerCase().includes('timed out') ||
        data.reason?.toLowerCase().includes('expire');

    if (!isExpiry) {
        await rabbitMQService.publishToQueue(QUEUES.ORDER_NOTIFY, {
            type: 'PAYMENT_FAILED',
            payload: {
                orderId: data.orderId,
                amount: data.amount,
                reason: data.reason,
                customerMobile: data.customerMobile,
            }
        });
        logger.info(`[Worker] Payment failure notification queued for order: ${data.orderId}`);
    } else {
        logger.info(`[Worker] Skipping Telegram alert for expired payment: ${data.orderId}`);
    }
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

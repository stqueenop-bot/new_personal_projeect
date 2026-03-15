import { Telegraf } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getPlatformNameFromUrl } from '../utils/platform.util';
import { prisma } from '../../lib/initiatePrisma';

/**
 * Telegram Bot Service (Main Backend)
 *
 * This service handles:
 *  - Sending SUCCESS notifications to the main bot
 *  - Sending FAILED ORDER alerts to the failed orders bot chat
 *
 * The "y"-reply approval handler lives in telegram-bot-backend/src/bot/failedOrderBot.ts
 * and uses the shared PostgreSQL DB to mark orders as COMPLETED.
 */
class TelegramService {
    private mainBot: Telegraf | null = null;
    private adminChatId: string;
    private isMainConfigured: boolean;

    private failedBotToken: string | null = null;
    private failedChatId: string | null = null;
    private isFailedConfigured: boolean;

    constructor() {
        this.adminChatId = env.TELEGRAM_ADMIN_CHAT_ID ?? '';
        this.isMainConfigured = !!(
            env.TELEGRAM_BOT_TOKEN &&
            !env.TELEGRAM_BOT_TOKEN.includes('your_') &&
            env.TELEGRAM_ADMIN_CHAT_ID &&
            !env.TELEGRAM_ADMIN_CHAT_ID.includes('your_')
        );

        if (this.isMainConfigured) {
            this.mainBot = new Telegraf(env.TELEGRAM_BOT_TOKEN as string);
        } else {
            logger.warn('[Telegram] Main bot not configured — success notifications will be skipped');
        }

        // Failed orders bot — only need the token to SEND messages (not to listen)
        this.failedBotToken = env.TELEGRAM_FAILED_BOT_TOKEN ?? null;
        this.failedChatId = env.TELEGRAM_FAILED_CHAT_ID ?? null;
        this.isFailedConfigured = !!(
            this.failedBotToken &&
            !this.failedBotToken.includes('your_') &&
            this.failedChatId &&
            !this.failedChatId.includes('your_')
        );

        if (!this.isFailedConfigured) {
            logger.warn('[Telegram] Failed orders bot not configured — failed alerts will go to main bot');
        }
    }

    // ─────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────

    private async sendToMain(message: string): Promise<void> {
        if (!this.isMainConfigured || !this.mainBot) {
            logger.debug('[Telegram] Main bot skipped (not configured)');
            return;
        }
        try {
            await this.mainBot.telegram.sendMessage(this.adminChatId, message, { parse_mode: 'HTML' });
        } catch (error) {
            logger.error('[Telegram] Failed to send to main bot:', error);
        }
    }

    // ─────────────────────────────────────────────
    // Public notification methods
    // ─────────────────────────────────────────────

    /**
     * Notify admin of a successfully placed order (main bot).
     */
    async notifyOrderSuccess(params: {
        orderId: string;
        serviceId: number;
        link: string;
        quantity: number;
        amount: number;
        utr: string;
        smmOrderId?: string | number;
        customerMobile?: string;
    }): Promise<void> {
        const platform = getPlatformNameFromUrl(params.link);
        const message =
            `✅ <b>ORDER PLACED SUCCESSFULLY</b>\n\n` +
            `🌐 <b>Platform:</b> ${platform}\n` +
            `🆔 <b>Order ID:</b> <code>${params.orderId}</code>\n` +
            `📦 <b>Service ID:</b> ${params.serviceId}\n` +
            `🔗 <b>Link:</b> ${params.link}\n` +
            `📊 <b>Quantity:</b> ${params.quantity}\n` +
            `💰 <b>Amount:</b> ₹${params.amount}\n` +
            `🏦 <b>UTR:</b> <code>${params.utr}</code>\n` +
            (params.smmOrderId ? `🎯 <b>SMM Order ID:</b> ${params.smmOrderId}\n` : '') +
            (params.customerMobile ? `📱 <b>Customer Mobile:</b> ${params.customerMobile}\n` : '') +
            `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        await this.sendToMain(message);
    }


    /**
     * Notify admin of a payment failure (main bot).
     */
    async notifyPaymentFailed(params: {
        orderId: string;
        amount: number;
        reason: string;
        customerMobile?: string;
    }): Promise<void> {
        const message =
            `❌ <b>PAYMENT FAILED</b>\n\n` +
            `🆔 <b>Order ID:</b> <code>${params.orderId}</code>\n` +
            `💰 <b>Amount:</b> ₹${params.amount}\n` +
            `⚠️ <b>Reason:</b> ${params.reason}\n` +
            (params.customerMobile ? `📱 <b>Customer Mobile:</b> ${params.customerMobile}\n` : '') +
            `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        await this.sendToMain(message);
    }

    /**
     * Notify admin of an SMM placement failure (failed orders bot).
     * This is called by the notification worker when an SMM_FAILED event is received.
     */
    async notifySmmOrderFailed(params: {
        orderId: string;
        serviceId: number;
        link: string;
        quantity: number;
        amount: number;
        utr?: string;
        smmOrderId?: string;
        error: string;
        apiKey?: string;
    }): Promise<void> {
        await this.notifyFailedOrderBot(params);
    }

    /**
     * Send a failed/manual order alert to the failed orders bot chat.
     * The telegram-bot-backend runs the listener that handles "y" replies.
     */
    async notifyFailedOrderBot(params: {
        orderId: string;
        serviceId: number;
        link: string;
        quantity: number;
        amount: number;
        utr?: string;
        smmOrderId?: string;
        error: string;
        apiKey?: string;
    }): Promise<void> {
        const platform = getPlatformNameFromUrl(params.link);
        const message =
            `🚨 <b>MANUAL ORDER REQUIRED</b>\n` +
            `💳 Payment received — SMM failed!\n\n` +
            `🌐 <b>Platform:</b> ${platform}\n` +
            `🆔 <b>Order ID:</b> <code>${params.orderId}</code>\n` +
            `📦 <b>Service ID:</b> ${params.serviceId}\n` +
            `🔗 <b>Link:</b> ${params.link}\n` +
            `📊 <b>Quantity:</b> ${params.quantity}\n` +
            `💰 <b>Amount:</b> ₹${params.amount}\n` +
            (params.utr ? `🏦 <b>UTR:</b> <code>${params.utr}</code>\n` : '') +
            (params.smmOrderId ? `🎯 <b>SMM Response:</b> ${params.smmOrderId}\n` : '') +
            `❌ <b>Error:</b> ${params.error}\n` +
            (params.apiKey ? `🔑 <b>SMM API Key:</b> <code>${params.apiKey}</code>\n` : '') +
            `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n` +
            `⚡ <b>Reply "y" to this message to approve manually.</b>`;

        if (this.isFailedConfigured && this.failedBotToken && this.failedChatId) {
            // Send via the failed bot's token so the listener in telegram-bot-backend can track replies
            try {
                const failedBot = new Telegraf(this.failedBotToken);
                const sentMsg = await failedBot.telegram.sendMessage(this.failedChatId, message, { parse_mode: 'HTML' });
                
                // Persist the messageId -> orderId mapping so the bot backend can find it
                try {
                    await prisma.failedOrderMessage.create({
                        data: {
                            messageId: sentMsg.message_id,
                            orderId: params.orderId,
                        }
                    });
                    logger.info(`[Telegram] Persisted failed order mapping: ${sentMsg.message_id} -> ${params.orderId}`);
                } catch (dbErr) {
                    logger.error(`[Telegram] Failed to persist mapping to DB:`, dbErr);
                }

                logger.info(`[Telegram] Failed order alert sent for ${params.orderId}`);
            } catch (error) {
                logger.error('[Telegram] Failed to send alert, falling back to main bot:', error);
                await this.sendToMain(message);
            }
        } else {
            // Fallback to main bot
            await this.sendToMain(message);
        }
    }

    /**
     * @deprecated — new-order creation notifications are disabled.
     */
    async notifyNewOrder(_params: {
        orderId: string;
        serviceId: number;
        link: string;
        quantity: number;
        amount: number;
        customerMobile?: string;
    }): Promise<void> {
        // Intentionally no-op.
    }
}

export const telegramService = new TelegramService();

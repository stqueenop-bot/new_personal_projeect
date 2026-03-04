import { Telegraf } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Telegram Bot Service
 * Sends order notifications to admin/user chat.
 */
class TelegramService {
    private bot: Telegraf;
    private adminChatId: string;
    private isConfigured: boolean;

    constructor() {
        this.bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
        this.adminChatId = env.TELEGRAM_ADMIN_CHAT_ID;
        // Skip if credentials are still placeholders
        this.isConfigured = !env.TELEGRAM_BOT_TOKEN.includes('your_') && !env.TELEGRAM_ADMIN_CHAT_ID.includes('your_');
        if (!this.isConfigured) {
            logger.warn('[Telegram] Bot token or chat ID not configured — notifications will be skipped');
        }
    }

    /**
     * Send a message to the admin chat.
     */
    async sendToAdmin(message: string): Promise<void> {
        await this.sendMessage(this.adminChatId, message);
    }

    /**
     * Send a message to a specific chat ID.
     */
    async sendMessage(chatId: string, message: string): Promise<void> {
        if (!this.isConfigured) {
            logger.debug(`[Telegram] Skipped (not configured)`);
            return;
        }
        try {
            await this.bot.telegram.sendMessage(chatId, message, {
                parse_mode: 'HTML',
            });
            logger.info(`[Telegram] Message sent to chat ${chatId}`);
        } catch (error) {
            logger.error(`[Telegram] Failed to send message to ${chatId}:`, error);
            // Don't throw — Telegram failure shouldn't crash the order flow
        }
    }

    /**
     * Format and send an order success notification.
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
        const message = `
✅ <b>ORDER PLACED SUCCESSFULLY</b>

🆔 <b>Order ID:</b> <code>${params.orderId}</code>
📦 <b>Service ID:</b> ${params.serviceId}
🔗 <b>Link:</b> ${params.link}
📊 <b>Quantity:</b> ${params.quantity}
💰 <b>Amount:</b> ₹${params.amount}
🏦 <b>UTR:</b> <code>${params.utr}</code>
${params.smmOrderId ? `🎯 <b>SMM Order ID:</b> ${params.smmOrderId}` : ''}
${params.customerMobile ? `📱 <b>Customer Mobile:</b> ${params.customerMobile}` : ''}
🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
    `.trim();

        await this.sendToAdmin(message);
    }

    /**
     * Format and send a payment failure notification.
     */
    async notifyPaymentFailed(params: {
        orderId: string;
        amount: number;
        reason: string;
        customerMobile?: string;
    }): Promise<void> {
        const message = `
❌ <b>PAYMENT FAILED</b>

🆔 <b>Order ID:</b> <code>${params.orderId}</code>
💰 <b>Amount:</b> ₹${params.amount}
⚠️ <b>Reason:</b> ${params.reason}
${params.customerMobile ? `📱 <b>Customer Mobile:</b> ${params.customerMobile}` : ''}
🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
    `.trim();

        await this.sendToAdmin(message);
    }

    /**
     * Format and send an SSM order failure notification.
     */
    async notifySmmOrderFailed(params: {
        orderId: string;
        serviceId: number;
        link: string;
        quantity: number;
        error: string;
    }): Promise<void> {
        const message = `
🚨 <b>SMM ORDER FAILED</b>

⚠️ <b>Payment was successful but SMM order placement failed!</b>

🆔 <b>Order ID:</b> <code>${params.orderId}</code>
📦 <b>Service ID:</b> ${params.serviceId}
🔗 <b>Link:</b> ${params.link}
📊 <b>Quantity:</b> ${params.quantity}
❌ <b>Error:</b> ${params.error}
🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

<b>⚡ Action Required: Manual order placement needed!</b>
    `.trim();

        await this.sendToAdmin(message);
    }

    /**
     * Send a new order received notification (before payment).
     */
    async notifyNewOrder(params: {
        orderId: string;
        serviceId: number;
        link: string;
        quantity: number;
        amount: number;
        customerMobile?: string;
    }): Promise<void> {
        const message = `
🆕 <b>NEW ORDER RECEIVED</b>

🆔 <b>Order ID:</b> <code>${params.orderId}</code>
📦 <b>Service ID:</b> ${params.serviceId}
🔗 <b>Link:</b> ${params.link}
📊 <b>Quantity:</b> ${params.quantity}
💰 <b>Amount:</b> ₹${params.amount}
${params.customerMobile ? `📱 <b>Customer Mobile:</b> ${params.customerMobile}` : ''}
🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⏳ Awaiting payment...
    `.trim();

        await this.sendToAdmin(message);
    }
}

export const telegramService = new TelegramService();

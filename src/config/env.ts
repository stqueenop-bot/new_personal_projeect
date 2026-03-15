import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ZapUPI
    ZAPUPI_TOKEN_KEY: z.string().optional(),
    ZAPUPI_SECRET_KEY: z.string().optional(),
    ZAPUPI_API_URL: z.string().default('https://api.zapupi.com/api'),

    // RabbitMQ
    RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),

    // Telegram
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
    TELEGRAM_FAILED_BOT_TOKEN: z.string().optional(),   // Bot for failed/manual orders
    TELEGRAM_FAILED_CHAT_ID: z.string().optional(),     // Admin chat for failed orders

    // SSM Panel (Supportive SMM)
    SUPPORTIVE_SMM_API_URL: z.string().default('https://supportivesmm.com/api/v2'),
    SUPPORTIVE_SMM_API_KEY: z.string().optional(),

    // IND SMM Panel
    IND_SMM_API_URL: z.string().default('https://indsmm.com/api/v2'),
    IND_SMM_API_KEY: z.string().optional(),

    // Frontend
    FRONTEND_URL: z.string().default('http://localhost:3001'),

    // Telegram notification control
    ENABLE_TELEGRAM: z.string().default('true').refine((v) => ['true', 'false'].includes(v.toLowerCase()), {
        message: 'ENABLE_TELEGRAM must be true or false',
    }).transform((v) => v.toLowerCase() === 'true'),

    // Bot worker
    ENABLE_BOT_WORKER: z.string().default('false').refine((v) => ['true', 'false'].includes(v.toLowerCase()), {
        message: 'ENABLE_BOT_WORKER must be true or false',
    }).transform((v) => v.toLowerCase() === 'true'),

    // Security
    API_AUTH_KEY: z.string().optional(),
    ZAPUPI_WEBHOOK_SECRET: z.string().optional(),
    ZAPUPI_WEBHOOK_IPS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;

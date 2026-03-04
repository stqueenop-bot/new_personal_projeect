import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ZapUPI
    ZAPUPI_TOKEN_KEY: z.string().min(1, 'ZAPUPI_TOKEN_KEY is required'),
    ZAPUPI_SECRET_KEY: z.string().min(1, 'ZAPUPI_SECRET_KEY is required'),
    ZAPUPI_API_URL: z.string().default('https://api.zapupi.com/api'),

    // RabbitMQ
    RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),

    // Telegram
    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    TELEGRAM_ADMIN_CHAT_ID: z.string().min(1, 'TELEGRAM_ADMIN_CHAT_ID is required'),

    // SSM Panel
    SSM_API_URL: z.string().default('https://supportivesmm.com/api/v2'),
    SSM_API_KEY: z.string().min(1, 'SSM_API_KEY is required'),

    // Frontend
    FRONTEND_URL: z.string().default('http://localhost:3001'),

    // Security
    API_AUTH_KEY: z.string().optional(),
    ZAPUPI_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;

import rateLimit from 'express-rate-limit';

// ─── Helper ──────────────────────────────────────────────────────────────────
// Render sits behind a proxy; trust it so real IPs are read from X-Forwarded-For
// This is set globally in app.ts via app.set('trust proxy', 1)

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
// Catch-all: 200 requests per IP per minute across all routes
export const globalRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,           // 1 minute window
    max: 200,                            // max 200 requests per IP per window
    standardHeaders: 'draft-7',         // Return `RateLimit-*` headers
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests, please slow down.',
    },
});

// ─── API Rate Limiter ─────────────────────────────────────────────────────────
// Tighter limit for general API endpoints: 100 req / IP / minute
export const apiRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many API requests. Please wait before retrying.',
    },
});

// ─── Order / Payment Rate Limiter ─────────────────────────────────────────────
// Aggressive: 100 order/payment submissions per IP per 5 minutes
export const sensitiveRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,          // 5 minute window
    max: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests to this endpoint. Please wait 10 minutes before trying again.',
    },
});

// ─── Webhook Rate Limiter ─────────────────────────────────────────────────────
// Webhooks should only come from a PSP – allow 120/min but throttle hard spikes
export const webhookRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Webhook rate limit exceeded.',
    },
});

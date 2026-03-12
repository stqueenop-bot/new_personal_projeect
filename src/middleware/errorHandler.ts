import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

export interface AppError extends Error {
    statusCode?: number;
    isOperational?: boolean;
}

/**
 * Global Express error handler.
 * Catches all errors thrown in routes/controllers and returns structured JSON.
 */
export function errorHandler(
    err: AppError | ZodError | Error,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction
): void {
    // ── Zod Validation Error ─────────────────────────────────────────────────
    if (err instanceof ZodError) {
        const issues = err.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
        logger.warn(
            `[ErrorHandler] 400 Validation Error — ${req.method} ${req.path}\n` +
            `  Body: ${JSON.stringify(req.body)}\n` +
            `  Issues:\n${issues}`
        );

        const response: ApiResponse = {
            success: false,
            message: 'Validation failed',
            error: err.issues.map(i => `${i.path.join('.') || 'field'}: ${i.message}`).join(', '),
        };
        res.status(400).json(response);
        return;
    }

    // ── Operational / App Errors ─────────────────────────────────────────────
    const appErr = err as AppError;
    const statusCode = appErr.statusCode ?? 500;
    const message = appErr.message ?? 'Internal Server Error';

    if (statusCode >= 500) {
        logger.error(
            `[ErrorHandler] ${statusCode} ${req.method} ${req.path} → ${message}` +
            (appErr.stack ? `\n${appErr.stack}` : '')
        );
    } else {
        // 4xx — log as warning with the request body for context
        logger.warn(
            `[ErrorHandler] ${statusCode} ${req.method} ${req.path} → ${message}` +
            (req.body && Object.keys(req.body).length
                ? `\n  Body: ${JSON.stringify(req.body)}`
                : '')
        );
    }

    const response: ApiResponse = {
        success: false,
        message,
        error: process.env.NODE_ENV === 'production' && statusCode === 500
            ? 'Internal Server Error'
            : message,
    };

    res.status(statusCode).json(response);
}

/**
 * Helper to create operational errors with custom status codes.
 */
export function createError(message: string, statusCode: number): AppError {
    const error: AppError = new Error(message);
    error.statusCode = statusCode;
    error.isOperational = true;
    return error;
}

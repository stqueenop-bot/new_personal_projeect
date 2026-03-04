import { Request, Response, NextFunction } from 'express';
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
    err: AppError,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction
): void {
    const statusCode = err.statusCode ?? 500;
    const message = err.message ?? 'Internal Server Error';

    logger.error(`[ErrorHandler] ${req.method} ${req.path} → ${statusCode}: ${message}`);

    if (statusCode === 500 && err.stack) {
        logger.error('[ErrorHandler] Stack trace:', err.stack);
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

import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { ApiResponse } from '../types';

/**
 * Optional API key authentication middleware.
 * Set API_AUTH_KEY in .env to enable protection.
 * Client must send: Authorization: Bearer <API_AUTH_KEY>
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    // Skip if no API_AUTH_KEY is configured
    if (!env.API_AUTH_KEY) {
        next();
        return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const response: ApiResponse = {
            success: false,
            message: 'Unauthorized: Missing API key',
        };
        res.status(401).json(response);
        return;
    }

    const providedKey = authHeader.split(' ')[1];

    if (providedKey !== env.API_AUTH_KEY) {
        const response: ApiResponse = {
            success: false,
            message: 'Unauthorized: Invalid API key',
        };
        res.status(401).json(response);
        return;
    }

    next();
}

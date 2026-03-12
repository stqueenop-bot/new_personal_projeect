import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

/**
 * Zod validation middleware factory.
 * Usage: router.post('/path', validate(MySchema), controller)
 *
 * On validation failure, logs the field errors with the request body
 * and returns a structured 400 response.
 */
export function validate(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const error = result.error as ZodError;
            const issues = error.issues
                .map(i => `  • ${i.path.join('.') || 'root'}: ${i.message}`)
                .join('\n');

            logger.warn(
                `[Validate] 400 ${req.method} ${req.path} — Validation failed\n` +
                `  Body: ${JSON.stringify(req.body)}\n` +
                `  Issues:\n${issues}`
            );

            const readableError = error.issues
                .map(i => `${i.path.join('.') || 'field'}: ${i.message}`)
                .join(', ');

            const response: ApiResponse = {
                success: false,
                message: 'Validation failed',
                error: readableError,
            };
            res.status(400).json(response);
            return;
        }

        req.body = result.data;
        next();
    };
}

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ApiResponse } from '../types';

/**
 * Zod validation middleware factory.
 * Usage: router.post('/path', validate(MySchema), controller)
 */
export function validate(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const errors = (result.error as ZodError).flatten().fieldErrors;
            const response: ApiResponse = {
                success: false,
                message: 'Validation failed',
                error: JSON.stringify(errors),
            };
            res.status(400).json(response);
            return;
        }

        req.body = result.data;
        next();
    };
}

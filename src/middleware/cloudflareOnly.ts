import type { Request, Response, NextFunction } from 'express';

/**
 * Blocks requests that didn't pass through Cloudflare's proxy.
 *
 * Cloudflare always injects `CF-Connecting-IP` on every proxied request.
 * If that header is missing the traffic hit your raw Render URL directly,
 * bypassing Cloudflare's DDoS shield entirely.
 *
 * ⚠️  DISABLED BY DEFAULT — only activates when you set
 *      CLOUDFLARE_ENABLED=true  in Render's Environment Variables.
 *
 * Steps to enable:
 *  1. Finish Cloudflare setup (domain → Cloudflare DNS → Render custom domain)
 *  2. Verify your site works through Cloudflare
 *  3. Add  CLOUDFLARE_ENABLED=true  in Render → Environment
 *  4. Redeploy — direct Render URL access will then be blocked
 */
export function cloudflareOnly(req: Request, res: Response, next: NextFunction): void {
    // Skip entirely unless explicitly opted in
    if (process.env.CLOUDFLARE_ENABLED !== 'true') {
        next();
        return;
    }

    const cfHeader = req.headers['cf-connecting-ip'];

    if (!cfHeader) {
        res.status(403).json({
            success: false,
            message: 'Direct access to this server is not permitted.',
        });
        return;
    }

    next();
}

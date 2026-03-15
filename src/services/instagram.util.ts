/**
 * Instagram URL detection utility.
 * Detects whether a URL is a profile, post, reel, or unknown.
 */

export type InstagramLinkType = 'profile' | 'post' | 'reel' | 'unknown';

/**
 * Detect the type of Instagram URL.
 */
export function detectInstagramLinkType(url: string): InstagramLinkType {
    try {
        const parsed = new URL(url);

        // Must be an Instagram domain
        const hostname = parsed.hostname.replace('www.', '');
        if (hostname !== 'instagram.com') {
            return 'unknown';
        }

        const path = parsed.pathname.replace(/\/+$/, ''); // trim trailing slashes
        const segments = path.split('/').filter(Boolean);

        if (segments.length === 0) {
            return 'unknown';
        }

        // /reel/<id> or /reels/<id>
        if (segments[0] === 'reel' || segments[0] === 'reels') {
            return 'reel';
        }

        // /p/<id>  (post)
        if (segments[0] === 'p') {
            return 'post';
        }

        // /tv/<id> (IGTV — treat as post)
        if (segments[0] === 'tv') {
            return 'post';
        }

        // /<username>  (profile — single segment, not a reserved path)
        const reservedPaths = ['explore', 'accounts', 'about', 'legal', 'developer', 'directory', 'stories'];
        if (segments.length === 1 && !reservedPaths.includes(segments[0])) {
            return 'profile';
        }

        // /<username>/reels or /<username>/tagged etc. — still a profile
        if (segments.length === 2 && !reservedPaths.includes(segments[0])) {
            if (segments[1] === 'p') return 'post';
            if (segments[1] === 'reel' || segments[1] === 'reels') return 'reel';
            return 'profile';
        }

        return 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Check if a URL is a valid Instagram URL.
 */
export function isInstagramUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace('www.', '');
        return hostname === 'instagram.com';
    } catch {
        return false;
    }
}

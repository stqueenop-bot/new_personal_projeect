/**
 * Detect the platform from a given URL.
 * e.g. https://www.youtube.com/... → "YouTube"
 */
export function getPlatformNameFromUrl(link: string): string {
    try {
        const url = new URL(link);
        const hostname = url.hostname.replace('www.', '').replace('m.', '');
        
        const map: Record<string, string> = {
            'instagram.com': 'Instagram',
            'youtube.com': 'YouTube',
            'youtu.be': 'YouTube',
            'spotify.com': 'Spotify',
            'facebook.com': 'Facebook',
            'twitter.com': 'Twitter / X',
            'x.com': 'Twitter / X',
            'telegram.org': 'Telegram',
            't.me': 'Telegram',
            'netflix.com': 'Netflix',
            'primevideo.com': 'Amazon Prime',
            'threads.net': 'Threads',
            'snapchat.com': 'Snapchat',
            'tiktok.com': 'TikTok',
        };

        // Check for exact matches
        if (map[hostname]) return map[hostname];

        // Check for partial matches (e.g., something.instagram.com)
        for (const [key, value] of Object.entries(map)) {
            if (hostname.endsWith(key)) return value;
        }

        // Capitalize the first part of host if no match
        const parts = hostname.split('.');
        if (parts.length >= 1) {
            return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        }

        return hostname;
    } catch {
        return 'Unknown';
    }
}

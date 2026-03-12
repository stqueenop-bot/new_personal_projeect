import { SmmProvider } from '../../generated/prisma/index.js';
import { ServiceCategory } from '../services/instagram.validator';

/**
 * Maps Service IDs to their respective SMM Providers.
 */
const SERVICE_PROVIDER_MAP: Record<number, SmmProvider> = {
    // Supportive SMM
    602: 'SUPPORTIVE', // Reel Views
    670: 'SUPPORTIVE', // Comment

    // IND SMM
    3924: 'IND', // Likes
    3822: 'IND', // Followers
};

/**
 * Maps Service IDs to their display names.
 */
const SERVICE_NAME_MAP: Record<number, string> = {
    602: 'Reel Views',
    670: 'Comment',
    3924: 'Likes',
    3822: 'Followers',
};

/**
 * Maps Service IDs to their specific categories.
 */
const SERVICE_CATEGORY_MAP: Record<number, ServiceCategory> = {
    602: 'views',
    670: 'comments',
    3924: 'likes',
    3822: 'followers',
};

/**
 * Determines the SMM Provider for a given Service ID.
 * Defaults to SUPPORTIVE if not found.
 */
export function getProviderForService(serviceId: number): SmmProvider {
    return SERVICE_PROVIDER_MAP[serviceId] || 'SUPPORTIVE';
}

/**
 * Gets the definitive service name for a given Service ID.
 */
export function getServiceNameForId(serviceId: number): string | null {
    return SERVICE_NAME_MAP[serviceId] || null;
}

/**
 * Gets the correct service category for a given Service ID.
 */
export function getCategoryForId(serviceId: number): ServiceCategory | null {
    return SERVICE_CATEGORY_MAP[serviceId] || null;
}

/**
 * Get display name for a provider.
 */
export function getProviderName(provider: SmmProvider): string {
    switch (provider) {
        case 'SUPPORTIVE': return 'Supportive SMM';
        case 'IND': return 'IND SMM';
        default: return 'Unknown Provider';
    }
}

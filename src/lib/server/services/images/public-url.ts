import { defaultStore } from '#lib/server/api/photos.js';

/** Public URL of a stored photo; null when no R2 public base URL is configured (dev, tests). */
export function publicUrl(key: string | null): string | null {
	if (!key) return null;
	try {
		return defaultStore().publicUrl(key);
	} catch {
		return null;
	}
}

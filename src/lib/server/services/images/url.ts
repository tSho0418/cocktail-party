import * as privateEnv from '$app/env/private';
import type { SIZES } from './process';

type PhotoSize = keyof typeof SIZES;

const DERIVATIVE = /^(.*\/)(?:list|detail)\.webp$/;

/**
 * Public URL of a stored Photo at `size`. A Recipe stores one key of the pair written by
 * `storePhoto` (`<prefix>/list.webp` or `<prefix>/detail.webp`); the other size is derived from it.
 * Null when no public base URL is configured (R2_PUBLIC_BASE_URL).
 */
export function photoUrl(
	key: string,
	size: PhotoSize,
	base: string | undefined = (privateEnv as Record<string, string | undefined>).R2_PUBLIC_BASE_URL
): string | null {
	if (!base) return null;
	const prefix = DERIVATIVE.exec(key)?.[1];
	return `${base.replace(/\/+$/, '')}/${prefix === undefined ? key : `${prefix}${size}.webp`}`;
}

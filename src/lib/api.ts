import { hc } from 'hono/client';
import type { AppType } from '#lib/server/api/app.js';

/** Typed client for the Hono API. Pass SvelteKit's `fetch` when calling from a load function. */
export const createApiClient = (fetch: typeof globalThis.fetch = globalThis.fetch) =>
	hc<AppType>('/', { fetch });

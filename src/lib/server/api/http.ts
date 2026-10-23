import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from 'hono';

export type ApiEnv = { Bindings: { locals: App.Locals } };

/** The signed-in Member for a route behind requireMember. */
export const actorOf = (c: Context<ApiEnv>) => {
	const m = c.env.locals.member!;
	return { memberId: m.id, isAdministrator: m.isAdministrator };
};

export const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** HTTP status for a service error code; anything not listed is a rejected input (422). */
export const statusOf = (error: string): ContentfulStatusCode =>
	error === 'not_found'
		? 404
		: error === 'forbidden' || error === 'suspended'
			? 403
			: error === 'duplicate'
				? 409
				: error === 'photo_daily_limit' || error === 'recipe_daily_limit'
					? 429
					: 422;

export const invalidRequest = (c: Context<Env>) =>
	c.json({ error: 'invalid_request' as const }, 400);

/** Query values as plain strings; a repeated parameter keeps its first value. */
export const firstValues = (q: Record<string, string | string[]>) =>
	Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === 'string' ? v : v[0]]));

/** Largest JSON body the Recipe/Ingredient routes read (a full Recipe is well under 25KB). */
export const MAX_JSON_BYTES = 64 * 1024;

/** Rejects on Content-Length before reading, and counts streamed bytes when it is absent. */
export const jsonBodyLimit = bodyLimit({
	maxSize: MAX_JSON_BYTES,
	onError: (c) => c.json({ error: 'too_large' as const }, 413)
});

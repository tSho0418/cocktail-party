import { createMiddleware } from 'hono/factory';

type Env = { Bindings: { locals: App.Locals } };

/** Hono guard: a signed-in, unsuspended Member who has set a Username (FR-052, FR-075). */
export const requireMember = createMiddleware<Env>(async (c, next) => {
	const member = c.env?.locals?.member;
	if (!member) return c.json({ error: 'unauthorized' }, 401);
	if (!member.username) return c.json({ error: 'username_required' }, 403);
	await next();
});

/** Hono guard: as requireMember, and member.is_administrator (FR-077). */
export const requireAdministrator = createMiddleware<Env>(async (c, next) => {
	const member = c.env?.locals?.member;
	if (!member) return c.json({ error: 'unauthorized' }, 401);
	if (!member.username || !member.isAdministrator) return c.json({ error: 'forbidden' }, 403);
	await next();
});

/** For photosRoute({ authorize }) in api/photos.ts: only a signed-in Member may upload. */
export const authorizePhotoUpload = requireMember;

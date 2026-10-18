import { Hono } from 'hono';
import { photosRoute } from './photos';
import { requireMember } from '#lib/server/auth/guards.js';

// Routes stay thin: business logic belongs in #lib/server/services.
export const app = new Hono<{ Bindings: { locals: App.Locals } }>()
	.basePath('/api')
	.get('/health', (c) => c.json({ ok: true }))
	.route('/photos', photosRoute())
	.get('/me', requireMember, (c) => c.json(c.env.locals.member));

export type AppType = typeof app;

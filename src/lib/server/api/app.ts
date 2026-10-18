import { Hono } from 'hono';
import { photosRoute } from './photos';

// Routes stay thin: business logic belongs in #lib/server/services.
export const app = new Hono<{ Bindings: { locals: App.Locals } }>()
	.basePath('/api')
	.get('/health', (c) => c.json({ ok: true }))
	.route('/photos', photosRoute());

export type AppType = typeof app;

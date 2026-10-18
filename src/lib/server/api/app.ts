import { Hono } from 'hono';

// Routes stay thin: business logic belongs in #lib/server/services.
export const app = new Hono().basePath('/api').get('/health', (c) => c.json({ ok: true }));

export type AppType = typeof app;

import { Hono } from 'hono';
import { defaultStore, photosRoute } from './photos';
import { ingredientsRoute } from './ingredients';
import { recipesRoute } from './recipes';
import { socialRoute } from './social';
import { reportsRoute } from './reports';
import type { ApiEnv } from './http';
import { authorizePhotoUpload, requireMember } from '#lib/server/auth/guards.js';
import type { ImageStore } from '#lib/server/services/images/index.js';

// Routes stay thin: business logic belongs in #lib/server/services.
export const createApp = ({ store = defaultStore }: { store?: () => ImageStore } = {}) =>
	new Hono<ApiEnv>()
		.basePath('/api')
		.get('/health', (c) => c.json({ ok: true }))
		.route('/photos', photosRoute({ authorize: authorizePhotoUpload, store }))
		.route('/recipes', recipesRoute({ store }))
		.route('/ingredients', ingredientsRoute())
		.route('/', socialRoute())
		.route('/', reportsRoute())
		.get('/me', requireMember, (c) => c.json(c.env.locals.member));

export const app = createApp();

export type AppType = typeof app;

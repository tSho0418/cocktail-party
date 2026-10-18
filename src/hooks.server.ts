import type { Handle } from '@sveltejs/kit/hooks';
import { app } from '#lib/server/api/app.js';

export const handle: Handle = ({ event, resolve }) =>
	event.url.pathname === '/api' || event.url.pathname.startsWith('/api/')
		? app.fetch(event.request)
		: resolve(event);

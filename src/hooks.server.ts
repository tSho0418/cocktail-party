import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { app } from '#lib/server/api/app.js';

const apiHandle: Handle = ({ event, resolve }) =>
	event.url.pathname === '/api' || event.url.pathname.startsWith('/api/')
		? app.fetch(event.request, { locals: event.locals })
		: resolve(event);

// apiHandle answers /api/* itself and never calls later handles, so auth/Suspension handles
// MUST be placed before it: /api must never bypass auth or Suspension checks (FR-075).
export const handle = sequence(apiHandle);

import { redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getSessionCookie } from 'better-auth/cookies';
import { R2_PUBLIC_BASE_URL } from '$app/env/private';
import { app } from '#lib/server/api/app.js';
import { isAuthEndpoint } from '#lib/server/auth/endpoints.js';
import { auth, resolveMember } from '#lib/server/auth/index.js';
import { photoOrigin, withSecurityHeaders } from '#lib/server/security-headers.js';

const isUnder = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(`${prefix}/`);

// Pages a Member without a Username may still reach (FR-052). /age-gate is one: the gate
// is also shown on /welcome, so it must be closable before a Username is chosen.
const BEFORE_USERNAME = ['/welcome', '/logout', '/withdraw', '/age-gate', '/terms', '/privacy'];

const authHandle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	// Resolved before Better Auth's own endpoints too, so a suspended Member's sessions are
	// revoked before any of them could return one (FR-075).
	event.locals.member = getSessionCookie(event.request)
		? await resolveMember(event.request.headers)
		: null;
	if (isUnder(pathname, '/api/auth'))
		return isAuthEndpoint(event.request.method, pathname)
			? auth().handler(event.request)
			: new Response(null, { status: 404 });

	const member = event.locals.member;
	if (
		member &&
		!member.username &&
		!isUnder(pathname, '/api') &&
		!BEFORE_USERNAME.some((p) => isUnder(pathname, p))
	)
		redirect(303, '/welcome');
	return resolve(event);
};

const apiHandle: Handle = ({ event, resolve }) =>
	isUnder(event.url.pathname, '/api')
		? app.fetch(event.request, { locals: event.locals })
		: resolve(event);

// Outermost, so every answer that goes through `handle` carries the headers (#66): pages, the error
// page, /api/* and Better Auth. Not covered: assets Vercel serves itself, and answers SvelteKit gives
// without going back through here: its CSRF 403 (before `handle`), and a redirect() or error thrown by
// a hook (a body-less 303, a plain error page).
const securityHeadersHandle: Handle = async ({ event, resolve }) =>
	withSecurityHeaders(await resolve(event), photoOrigin(R2_PUBLIC_BASE_URL));

// apiHandle answers /api/* itself and never calls later handles, so auth/Suspension handles
// MUST be placed before it: /api must never bypass auth or Suspension checks (FR-075).
export const handle = sequence(securityHeadersHandle, authHandle, apiHandle);

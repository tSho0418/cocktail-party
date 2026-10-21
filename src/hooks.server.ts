import { redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getSessionCookie } from 'better-auth/cookies';
import { app } from '#lib/server/api/app.js';
import { auth, resolveMember } from '#lib/server/auth/index.js';

const isUnder = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(`${prefix}/`);

// Pages a Member without a Username may still reach (FR-052). /age-gate is one: the gate
// is also shown on /welcome, so it must be closable before a Username is chosen.
const BEFORE_USERNAME = ['/welcome', '/logout', '/withdraw', '/age-gate', '/terms', '/privacy'];

const authHandle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	// Resolved before Better Auth's own endpoints too, so a suspended Member's sessions are
	// revoked before /api/auth/get-session could return one (FR-075).
	event.locals.member = getSessionCookie(event.request)
		? await resolveMember(event.request.headers)
		: null;
	if (isUnder(pathname, '/api/auth')) return auth().handler(event.request);

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

// apiHandle answers /api/* itself and never calls later handles, so auth/Suspension handles
// MUST be placed before it: /api must never bypass auth or Suspension checks (FR-075).
export const handle = sequence(authHandle, apiHandle);

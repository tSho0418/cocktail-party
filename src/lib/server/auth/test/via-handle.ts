import type { RequestEvent } from '@sveltejs/kit';
// shortcut: SvelteKit internal, needed because sequence() and Better Auth's cookie plugin read
// the request store; replace if SvelteKit ships a public way to run code inside a request in tests.
// @ts-expect-error untyped internal module
import { with_request_store } from '@sveltejs/kit/internal/server';
import { handle } from '../../../../hooks.server';

/** Runs `fn` as if inside a request for `event` (what `getRequestEvent()` returns there). */
export const inRequest = <T>(event: RequestEvent, fn: () => T): T =>
	with_request_store({ event, state: {} } as never, fn);

/** Runs the real `handle` chain for one request; a page that reaches SvelteKit answers 'page'. */
export function viaHandle(url: string, cookie = '', init: RequestInit = {}) {
	const request = new Request(url, {
		...init,
		headers: { cookie, ...(init.headers as Record<string, string> | undefined) }
	});
	const event = { request, url: new URL(url), locals: {} } as unknown as RequestEvent;
	return inRequest(event, () => handle({ event, resolve: async () => new Response('page') }));
}

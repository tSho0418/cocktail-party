import type { RequestEvent } from '@sveltejs/kit';
// shortcut: SvelteKit internal, needed because sequence() reads the request store; replace if
// SvelteKit ships a public way to invoke `handle` in tests.
// @ts-expect-error untyped internal module
import { with_request_store } from '@sveltejs/kit/internal/server';
import { handle } from '../../../../hooks.server';

/** Runs the real `handle` chain for one request; a page that reaches SvelteKit answers 'page'. */
export function viaHandle(url: string, cookie = '', init: RequestInit = {}) {
	const request = new Request(url, {
		...init,
		headers: { cookie, ...(init.headers as Record<string, string> | undefined) }
	});
	const event = { request, url: new URL(url), locals: {} } as unknown as RequestEvent;
	return with_request_store({ event, state: {} } as never, () =>
		handle({ event, resolve: async () => new Response('page') })
	);
}

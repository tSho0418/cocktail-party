import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import type { Cookies } from '@sveltejs/kit';
import { AGE_GATE_COOKIE, AGE_GATE_MAX_AGE_SECONDS } from '#lib/age-gate.js';
import { load } from './+layout.server';
import { POST } from './age-gate/+server';
import Layout from './+layout.svelte';

const body = createRawSnippet(() => ({
	render: () => '<main><h1>ジントニックの作り方</h1></main>'
}));

const cookiesWith = (jar: Record<string, string>) => {
	const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		get: (name: string) => jar[name],
		set: (name: string, value: string, opts: Record<string, unknown>) =>
			set.push({ name, value, opts })
	} as unknown as Cookies;
	return { cookies, set };
};

// Mocks the SvelteKit `page` state the gate reads.
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/recipes/1?x=1') } }));

const html = (ageGateOpen: boolean) =>
	render(Layout, { props: { data: { ageGateOpen }, children: body } as never }).body;

describe('Age Gate on the server', () => {
	it('renders the page body together with the gate while the gate is open (FR-062)', () => {
		const out = html(true);
		expect(out).toContain('ジントニックの作り方');
		expect(out).toMatch(/<div style="display: contents" inert=""><main>/);
		expect(out).toContain('data-age-gate');
		expect(out).toContain('role="dialog"');
		expect(out).toContain('name="redirectTo" value="/recipes/1?x=1"');
	});

	it('leaves only the page once consented', () => {
		const out = html(false);
		expect(out).toContain('ジントニックの作り方');
		expect(out).not.toContain('data-age-gate');
	});

	it('opens the gate for a first visit and closes it with the cookie', () => {
		const first = load({
			cookies: cookiesWith({}).cookies,
			url: new URL('http://localhost/')
		} as never);
		const returning = load({
			cookies: cookiesWith({ [AGE_GATE_COOKIE]: '1' }).cookies,
			url: new URL('http://localhost/')
		} as never);
		expect(first).toEqual({ ageGateOpen: true });
		expect(returning).toEqual({ ageGateOpen: false });
	});

	it('keeps the terms and privacy pages open to a visitor who has not consented', () => {
		for (const path of ['/terms', '/privacy']) {
			const out = load({
				cookies: cookiesWith({}).cookies,
				url: new URL(`http://localhost${path}`)
			} as never);
			expect(out).toEqual({ ageGateOpen: false });
		}
	});

	it('consent sets a 30-day cookie and redirects back', async () => {
		const { cookies, set } = cookiesWith({});
		const request = new Request('http://localhost/age-gate', {
			method: 'POST',
			body: new URLSearchParams({ redirectTo: '/recipes/1?x=1' })
		});
		const res = await (async () => POST({ request, cookies } as never))().catch((e: unknown) => e);
		expect(res).toMatchObject({ status: 303, location: '/recipes/1?x=1' });
		expect(set).toHaveLength(1);
		expect(set[0].name).toBe(AGE_GATE_COOKIE);
		expect(set[0].opts.maxAge).toBe(AGE_GATE_MAX_AGE_SECONDS);
		expect(set[0].opts.path).toBe('/');
	});

	it('does not redirect off-site', async () => {
		const request = new Request('http://localhost/age-gate', {
			method: 'POST',
			body: new URLSearchParams({ redirectTo: 'https://evil.example' })
		});
		const res = await (async () =>
			POST({ request, cookies: cookiesWith({}).cookies } as never))().catch((e: unknown) => e);
		expect(res).toMatchObject({ location: '/' });
	});
});

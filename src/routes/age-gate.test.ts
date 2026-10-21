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
const state = vi.hoisted(() => ({ url: new URL('http://localhost/recipes/1?x=1') }));
vi.mock('$app/state', () => ({ page: state }));

const html = (ageGateOpen: boolean) =>
	render(Layout, { props: { data: { ageGateOpen, member: null }, children: body } as never }).body;

describe('Age Gate on the server', () => {
	it('renders the page body together with the gate while the gate is open (FR-062)', () => {
		const out = html(true);
		expect(out).toContain('ジントニックの作り方');
		expect(out).toMatch(/<div style="display: contents" inert="">.*<main>/);
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
		const locals = { member: null };
		const first = load({ cookies: cookiesWith({}).cookies, locals } as never);
		const returning = load({
			cookies: cookiesWith({ [AGE_GATE_COOKIE]: '1' }).cookies,
			locals
		} as never);
		expect(first).toMatchObject({ ageGateOpen: true });
		expect(returning).toMatchObject({ ageGateOpen: false });
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
		expect(set[0].opts).toEqual({
			path: '/',
			maxAge: AGE_GATE_MAX_AGE_SECONDS,
			httpOnly: true,
			sameSite: 'lax'
		});
	});

	it('shows navigation by sign-in state, and footer links always', () => {
		const nav = (member: { username: string | null; isAdministrator: boolean } | null) =>
			render(Layout, { props: { data: { ageGateOpen: false, member }, children: body } as never })
				.body;
		const out = nav(null);
		expect(out).toContain('ログイン');
		expect(out).not.toContain('マイページ');
		expect(out).toContain('href="/terms"');
		expect(out).toContain('href="/privacy"');

		const member = nav({ username: 'alice', isAdministrator: false });
		expect(member).toContain('href="/members/alice"');
		expect(member).toContain('href="/members/alice?tab=saved"');
		expect(member).toContain('href="/recipes/new"');
		expect(member).toContain('href="/logout"');
		expect(member).not.toContain('href="/admin"');
		expect(nav({ username: 'alice', isAdministrator: true })).toContain('href="/admin"');

		const fresh = nav({ username: null, isAdministrator: false });
		expect(fresh).toContain('href="/welcome"');
		expect(fresh).not.toContain('href="/recipes/new"');
		expect(nav({ username: null, isAdministrator: true })).not.toContain('href="/admin"');
	});

	it('keeps the declined view out of search indexes (NFR-007)', () => {
		const head = (url: string) => {
			state.url = new URL(url);
			return render(Layout, {
				props: { data: { ageGateOpen: true, member: null }, children: body } as never
			}).head;
		};
		expect(head('http://localhost/recipes/1?age-gate=declined')).toContain(
			'<meta name="robots" content="noindex"'
		);
		expect(head('http://localhost/recipes/1')).not.toContain('noindex');
		state.url = new URL('http://localhost/recipes/1?x=1');
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

import { randomUUID } from 'node:crypto';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMember as resolveInHandle } from '#lib/server/auth/index.js';
import { cookiesOf, lineLogin, ORIGIN } from '#lib/server/auth/test/line-login.js';
import { inRequest } from '#lib/server/auth/test/via-handle.js';
import { db } from '#lib/server/db/index.js';
import { member, photoUpload, recipe, session } from '#lib/server/db/schema.js';
import { memoryImageStore, type ImageStore } from '#lib/server/services/images/index.js';
import { actions } from './+page.server';

// The action builds its R2 client from env vars that tests do not have, so it gets a fake store.
const storage = vi.hoisted(() => ({ current: undefined as ImageStore | undefined }));
vi.mock(import('#lib/server/api/photos.js'), async (importOriginal) => ({
	...(await importOriginal()),
	defaultStore: () => storage.current!
}));

afterEach(() => vi.unstubAllGlobals());

// A request whose session is gone makes Better Auth clear the cookie, which needs a request event.
const resolveMember = (headers: Headers) =>
	inRequest({ cookies: { set() {} } } as unknown as RequestEvent, () => resolveInHandle(headers));

/** A signed-in Member who has not chosen a Username yet, with a Recipe, an unused upload and an icon. */
async function signedInMember() {
	const store = memoryImageStore();
	const cookie = cookiesOf(await lineLogin({ sub: `U-withdraw-${randomUUID()}` }));
	const headers = new Headers({ cookie });
	const signedIn = (await resolveMember(headers))!;
	const upload = async (kind: 'recipe' | 'member') => {
		const id = randomUUID();
		await db.insert(photoUpload).values({ id, memberId: signedIn.id, kind });
		for (const file of ['list', 'detail'])
			await store.put(`${kind}/${id}/${file}.webp`, new Uint8Array([1]), 'image/webp');
		return `${kind}/${id}/list.webp`;
	};
	const main = await upload('recipe');
	await upload('recipe');
	const icon = await upload('member');
	await db.update(member).set({ iconKey: icon }).where(eq(member.id, signedIn.id));
	await db.insert(recipe).values({ memberId: signedIn.id, title: 't', mainPhotoKey: main });
	storage.current = store;
	return { signedIn, cookie, headers, store };
}

/** Posts the form as hooks.server.ts would hand it over; returns what the action threw (a redirect) and the cookies it set. */
async function withdraw(who: App.Locals['member'], cookie = '') {
	const cookieWrites: { name: string; maxAge?: number }[] = [];
	const event = {
		locals: { member: who },
		request: new Request(`${ORIGIN}/withdraw`, { method: 'POST', headers: { cookie } }),
		cookies: {
			set: (name: string, _value: string, opts: { maxAge?: number }) =>
				cookieWrites.push({ name, maxAge: opts.maxAge })
		}
	} as unknown as RequestEvent;
	let thrown: unknown;
	try {
		await inRequest(event, async () =>
			actions.default(event as Parameters<typeof actions.default>[0])
		);
	} catch (e) {
		thrown = e;
	}
	return { thrown, cookieWrites };
}

const redirectOf = (e: unknown) => isRedirect(e) && [e.status, e.location];
const sessionCookieCleared = (writes: { name: string; maxAge?: number }[]) =>
	writes.some((c) => c.name.includes('session_token') && c.maxAge === 0);

describe('/withdraw action (FR-058)', () => {
	it('sends a signed-out visitor to /login and changes nothing', async () => {
		const { signedIn, store } = await signedInMember();
		const { thrown } = await withdraw(null);
		expect(redirectOf(thrown)).toEqual([303, '/login']);
		expect(await db.select().from(member).where(eq(member.id, signedIn.id))).toHaveLength(1);
		expect(store.objects.size).toBe(6);
	});

	it('deletes a Member who has no Username, with every stored photo, signs them out and goes to /', async () => {
		const { signedIn, cookie, headers, store } = await signedInMember();
		expect(signedIn.username).toBeNull();

		const { thrown, cookieWrites } = await withdraw(signedIn, cookie);

		expect(redirectOf(thrown)).toEqual([303, '/']);
		expect(await db.select().from(member).where(eq(member.id, signedIn.id))).toEqual([]);
		expect(await db.select().from(recipe).where(eq(recipe.memberId, signedIn.id))).toEqual([]);
		expect(store.objects.size).toBe(0);
		expect(sessionCookieCleared(cookieWrites)).toBe(true);
		expect(await resolveMember(headers)).toBeNull();
	});

	it('still withdraws and signs out when storage refuses the deletions', async () => {
		const { signedIn, cookie, headers, store } = await signedInMember();
		storage.current = {
			...store,
			delete: async () => {
				throw new Error('R2 unavailable');
			}
		};
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { thrown, cookieWrites } = await withdraw(signedIn, cookie);

			expect(redirectOf(thrown)).toEqual([303, '/']);
			expect(await db.select().from(member).where(eq(member.id, signedIn.id))).toEqual([]);
			expect(sessionCookieCleared(cookieWrites)).toBe(true);
			expect(await resolveMember(headers)).toBeNull();
			// Left behind, and every key logged: the rows are gone, so the log is the only record.
			const leftover = [...store.objects.keys()].sort();
			expect(leftover).toHaveLength(6);
			expect(log.mock.calls.map((c) => c.slice(0, 2)).sort()).toEqual(
				leftover.map((key) => ['photo cleanup failed', key])
			);
		} finally {
			log.mockRestore();
		}
	});

	it('leaves the Member signed in, with their data, when the withdrawal itself fails (#27)', async () => {
		const { signedIn, cookie, headers, store } = await signedInMember();
		// A row that blocks deleting this Member (a plain foreign key) makes the transaction fail.
		await db.execute(sql`create table withdraw_blocker (member_id uuid references member(id))`);
		try {
			await db.execute(sql`insert into withdraw_blocker values (${signedIn.id})`);

			const { thrown, cookieWrites } = await withdraw(signedIn, cookie);

			expect(isRedirect(thrown)).toBe(false);
			expect(thrown).toBeInstanceOf(Error);
			expect(await db.select().from(member).where(eq(member.id, signedIn.id))).toHaveLength(1);
			expect(await db.select().from(recipe).where(eq(recipe.memberId, signedIn.id))).toHaveLength(
				1
			);
			expect(await db.select().from(session).where(eq(session.userId, signedIn.id))).toHaveLength(
				1
			);
			expect(await resolveMember(headers)).toMatchObject({ id: signedIn.id });
			expect(cookieWrites).toEqual([]);
			expect(store.objects.size).toBe(6);
		} finally {
			await db.execute(sql`drop table withdraw_blocker`);
		}
	});
});

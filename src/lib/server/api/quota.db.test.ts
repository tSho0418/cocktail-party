import { randomUUID } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { photoUpload, quotaUse, recipe } from '#lib/server/db/schema.js';
import { memoryImageStore } from '#lib/server/services/images/index.js';
import { jpegWithGps } from '#lib/server/services/images/test-fixtures.js';
import { DAILY_LIMITS, type QuotaKind } from '#lib/server/services/quota/index.js';
import { createApp } from './app';
import { call, seedMember, type TestMember } from './test-helpers';

const { photo: PHOTO_LIMIT, recipe: RECIPE_LIMIT } = DAILY_LIMITS;
const tag = randomUUID().slice(0, 8);
let admin: TestMember;
let gin: string;

beforeAll(async () => {
	admin = await seedMember('admin_quota', { isAdministrator: true });
	gin = (
		await (
			await call(admin, 'POST', '/ingredients', {
				name: `ジンquota${tag}`,
				abvPercent: 40,
				isBaseSpirit: true
			})
		).json()
	).id;
});

/** A store that counts writes: a refused request must not reach it. */
function countingStore() {
	const store = memoryImageStore();
	let puts = 0;
	return {
		store: {
			...store,
			async put(key: string, data: Uint8Array, contentType: string) {
				puts++;
				return store.put(key, data, contentType);
			}
		},
		puts: () => puts
	};
}

const upload = async (as: TestMember, s = countingStore()) => {
	const res = await createApp({ store: () => s.store }).request(
		'/api/photos',
		{
			method: 'POST',
			body: new Uint8Array(await jpegWithGps()),
			headers: { 'content-type': 'application/octet-stream' }
		},
		{ locals: { member: as } }
	);
	return { res, puts: s.puts };
};

/** `n` uses of `kind` that happened `hoursAgo` hours ago. */
async function seedUses(as: TestMember, kind: QuotaKind, n: number, hoursAgo = 1) {
	await db.insert(quotaUse).values(
		Array.from({ length: n }, () => ({
			memberId: as.id,
			kind,
			createdAt: sql`now() - ${`${hoursAgo} hours`}::interval` as unknown as Date
		}))
	);
}

const usesOf = async (as: TestMember, kind: QuotaKind) =>
	(
		await db
			.select({ n: count() })
			.from(quotaUse)
			.where(and(eq(quotaUse.memberId, as.id), eq(quotaUse.kind, kind)))
	)[0].n;

const uploadsOf = async (as: TestMember) =>
	(await db.select({ n: count() }).from(photoUpload).where(eq(photoUpload.memberId, as.id)))[0].n;

const recipesOf = async (as: TestMember) =>
	(await db.select({ n: count() }).from(recipe).where(eq(recipe.memberId, as.id)))[0].n;

describe('POST /api/photos daily limit', () => {
	it('takes the last upload of the day, then answers 429 and creates nothing', async () => {
		const m = await seedMember('photo_limit');
		await seedUses(m, 'photo', PHOTO_LIMIT - 1);
		const s = countingStore();

		const last = await upload(m, s);
		expect(last.res.status).toBe(201);
		expect(last.puts()).toBe(2);
		expect(await uploadsOf(m)).toBe(1);

		const refused = await upload(m, s);
		expect(refused.res.status).toBe(429);
		expect(await refused.res.json()).toEqual({ error: 'photo_daily_limit' });
		expect(refused.puts()).toBe(2); // no R2 write for the refused one
		expect(s.store.objects.size).toBe(2);
		expect(await uploadsOf(m)).toBe(1);
		expect(await usesOf(m, 'photo')).toBe(PHOTO_LIMIT);
	});

	it('does not count uses older than 24 hours, and drops them', async () => {
		const m = await seedMember('photo_old');
		await seedUses(m, 'photo', PHOTO_LIMIT, 25);
		expect((await upload(m)).res.status).toBe(201);
		expect(await usesOf(m, 'photo')).toBe(1); // only the new one is left

		const n = await seedMember('photo_new');
		await seedUses(n, 'photo', PHOTO_LIMIT, 23);
		expect((await upload(n)).res.status).toBe(429);
	});

	it("does not count another Member's uploads or this Member's Recipes", async () => {
		const busy = await seedMember('photo_busy');
		const m = await seedMember('photo_quiet');
		await seedUses(busy, 'photo', PHOTO_LIMIT);
		await seedUses(m, 'recipe', RECIPE_LIMIT);
		expect((await upload(busy)).res.status).toBe(429);
		expect((await upload(m)).res.status).toBe(201);
	});

	it('counts an Administrator like any Member', async () => {
		const a = await seedMember('admin_photo', { isAdministrator: true });
		await seedUses(a, 'photo', PHOTO_LIMIT);
		expect((await upload(a)).res.status).toBe(429);
	});

	it('counts a Member icon upload too', async () => {
		const m = await seedMember('photo_icon');
		await seedUses(m, 'photo', PHOTO_LIMIT - 1);
		const s = countingStore();
		const icon = await createApp({ store: () => s.store }).request(
			'/api/photos?kind=member',
			{
				method: 'POST',
				body: new Uint8Array(await jpegWithGps()),
				headers: { 'content-type': 'application/octet-stream' }
			},
			{ locals: { member: m } }
		);
		expect(icon.status).toBe(201);
		expect((await upload(m, s)).res.status).toBe(429);
	});

	it('lets simultaneous uploads overshoot by at most the requests in flight, then holds', async () => {
		const m = await seedMember('photo_race');
		await seedUses(m, 'photo', PHOTO_LIMIT - 1);
		const burst = await Promise.all(Array.from({ length: 4 }, () => upload(m)));
		const accepted = burst.filter((r) => r.res.status === 201).length;
		expect(accepted).toBeGreaterThanOrEqual(1);
		expect(burst.every((r) => [201, 429].includes(r.res.status))).toBe(true);
		expect(await usesOf(m, 'photo')).toBe(PHOTO_LIMIT - 1 + accepted);
		expect((await upload(m)).res.status).toBe(429);
	});

	it('does not give a use back when the photo is released (upload, publish, delete, repeat)', async () => {
		const m = await seedMember('photo_loop');
		await seedUses(m, 'photo', PHOTO_LIMIT - 1);
		const s = countingStore();
		const { res } = await upload(m, s);
		expect(res.status).toBe(201);
		const { keys } = await res.json();
		const made = await call(m, 'POST', '/recipes', {
			title: `ループ${tag}`,
			mainPhotoKey: keys.detail,
			ingredients: [{ ingredientId: gin, mixRatio: 3 }],
			steps: ['注ぐ']
		});
		expect(made.status).toBe(201);
		expect((await call(m, 'DELETE', `/recipes/${(await made.json()).id}`)).status).toBe(204);
		expect(await uploadsOf(m)).toBe(0); // the upload row went with the Recipe...
		expect((await upload(m, s)).res.status).toBe(429); // ...but the use stays counted
	});
});

describe('POST /api/recipes daily limit', () => {
	let photoKey: string;
	let m: TestMember;
	beforeAll(async () => {
		m = await seedMember('recipe_limit');
		const { res } = await upload(m);
		photoKey = (await res.json()).keys.detail;
	});

	const publish = (as: TestMember, title: string, extra: object = {}) =>
		call(as, 'POST', '/recipes', {
			title,
			mainPhotoKey: photoKey,
			ingredients: [{ ingredientId: gin, mixRatio: 3 }],
			steps: ['注ぐ'],
			...extra
		});

	it('takes the last Recipe of the day, then answers 429 and creates nothing', async () => {
		// Recipes share one upload (ADR 0006), so one photo serves them all.
		for (let i = 0; i < RECIPE_LIMIT; i++)
			expect((await publish(m, `上限${i}${tag}`)).status).toBe(201);
		expect(await recipesOf(m)).toBe(RECIPE_LIMIT);

		const refused = await publish(m, `超過${tag}`);
		expect(refused.status).toBe(429);
		expect(await refused.json()).toEqual({ error: 'recipe_daily_limit' });
		expect(await recipesOf(m)).toBe(RECIPE_LIMIT);
		expect(await usesOf(m, 'recipe')).toBe(RECIPE_LIMIT);
	});

	it('still answers a resent idempotency key with its Recipe at the limit, and does not count it', async () => {
		const k = await seedMember('recipe_resend');
		const key = randomUUID();
		const { res: up } = await upload(k);
		photoKey = (await up.json()).keys.detail;
		await seedUses(k, 'recipe', RECIPE_LIMIT - 1);

		const first = await publish(k, `再送${tag}`, { idempotencyKey: key });
		expect(first.status).toBe(201);
		const again = await publish(k, `再送${tag}`, { idempotencyKey: key });
		expect(again.status).toBe(201);
		expect(await again.json()).toEqual(await first.json());
		expect(await recipesOf(k)).toBe(1);
		expect(await usesOf(k, 'recipe')).toBe(RECIPE_LIMIT);
		// A different key is a new Recipe, which the limit refuses.
		expect((await publish(k, `別鍵${tag}`, { idempotencyKey: randomUUID() })).status).toBe(429);
	});

	it('does not count uses older than 24 hours, other Members, or edits', async () => {
		const k = await seedMember('recipe_window');
		const { res: up } = await upload(k);
		photoKey = (await up.json()).keys.detail;
		await seedUses(k, 'recipe', RECIPE_LIMIT, 25);
		const made = await publish(k, `窓${tag}`);
		expect(made.status).toBe(201);

		await seedUses(k, 'recipe', RECIPE_LIMIT - 2); // 1 (new) + 8 = 9 in the window
		const id = (await made.json()).id;
		const edit = await call(k, 'PUT', `/recipes/${id}`, {
			title: `窓改${tag}`,
			mainPhotoKey: photoKey,
			ingredients: [{ ingredientId: gin, mixRatio: 3 }],
			steps: ['注ぐ']
		});
		expect(edit.status).toBe(200);
		expect(await usesOf(k, 'recipe')).toBe(RECIPE_LIMIT - 1 + RECIPE_LIMIT); // edit added none

		const other = await seedMember('recipe_other');
		const { res: up2 } = await upload(other);
		photoKey = (await up2.json()).keys.detail;
		await seedUses(k, 'recipe', 1); // k is now at the limit; `other` is not
		expect((await publish(k, `窓超過${tag}`)).status).toBe(429);
		expect((await publish(other, `他人${tag}`)).status).toBe(201);
	});

	it('does not give a use back when the Recipes are deleted', async () => {
		const k = await seedMember('recipe_refund');
		for (let i = 0; i < RECIPE_LIMIT; i++) {
			// Deleting the Recipe releases its photo, so each one needs a new upload.
			photoKey = (await (await upload(k)).res.json()).keys.detail;
			const res = await publish(k, `返金${i}${tag}`);
			expect(res.status).toBe(201);
			expect((await call(k, 'DELETE', `/recipes/${(await res.json()).id}`)).status).toBe(204);
		}
		expect(await recipesOf(k)).toBe(0);
		expect((await publish(k, `返金超過${tag}`)).status).toBe(429);
	});

	it('counts an Administrator like any Member', async () => {
		const a = await seedMember('admin_recipe', { isAdministrator: true });
		const { res: up } = await upload(a);
		photoKey = (await up.json()).keys.detail;
		await seedUses(a, 'recipe', RECIPE_LIMIT);
		expect((await publish(a, `管理者${tag}`)).status).toBe(429);
	});
});

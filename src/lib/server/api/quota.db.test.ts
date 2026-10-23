import { randomUUID } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { photoUpload, quotaUse, recipe } from '#lib/server/db/schema.js';
import { memoryImageStore } from '#lib/server/services/images/index.js';
import { jpegWithGps } from '#lib/server/services/images/test-fixtures.js';
import {
	DAILY_LIMITS,
	pruneAllQuotaUse,
	type QuotaKind
} from '#lib/server/services/quota/index.js';
import { holdingTransaction, waitForLockWaiters } from '#lib/server/db/test/concurrency.js';
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

	it('counts an upload that fails to decode, so garbage cannot use CPU without limit', async () => {
		const m = await seedMember('photo_garbage');
		await seedUses(m, 'photo', PHOTO_LIMIT - 1);
		const s = countingStore();
		const garbage = await createApp({ store: () => s.store }).request(
			'/api/photos',
			{
				method: 'POST',
				body: new TextEncoder().encode('<?php echo 1; ?>'),
				headers: { 'content-type': 'application/octet-stream' }
			},
			{ locals: { member: m } }
		);
		expect(garbage.status).toBe(422);
		expect(await usesOf(m, 'photo')).toBe(PHOTO_LIMIT);
		expect((await upload(m, s)).res.status).toBe(429);
	});

	it('takes the use before the slow work: uploads that arrive while the last one is in flight are refused', async () => {
		const m = await seedMember('photo_race');
		await seedUses(m, 'photo', PHOTO_LIMIT - 1);
		// Every R2 write waits on the gate, so each request that was accepted stays in flight.
		const gate = Promise.withResolvers<void>();
		const base = memoryImageStore();
		let puts = 0;
		const slow = {
			...base,
			async put(key: string, data: Uint8Array, contentType: string) {
				puts++;
				await gate.promise;
				return base.put(key, data, contentType);
			}
		};
		const s = { store: slow, puts: () => puts };
		const first = upload(m, s);
		while (puts < 2) await new Promise((r) => setTimeout(r, 10)); // in flight, stuck at R2
		const others = await Promise.all(Array.from({ length: 7 }, () => upload(m, s)));
		expect(others.map((r) => r.res.status)).toEqual(Array(7).fill(429));
		expect(puts).toBe(2); // none of them got as far as R2
		gate.resolve();
		expect((await first).res.status).toBe(201);
		expect(await usesOf(m, 'photo')).toBe(PHOTO_LIMIT);
		expect(await uploadsOf(m)).toBe(1);
	});

	it('never lets more than the limit through a burst, whatever the timing', async () => {
		const m = await seedMember('photo_burst');
		await seedUses(m, 'photo', PHOTO_LIMIT - 3);
		const burst = await Promise.all(Array.from({ length: 10 }, () => upload(m)));
		const accepted = burst.filter((r) => r.res.status === 201).length;
		expect(burst.every((r) => [201, 429].includes(r.res.status))).toBe(true);
		expect(accepted).toBeLessThanOrEqual(3);
		expect(await usesOf(m, 'photo')).toBe(PHOTO_LIMIT - 3 + accepted);
		expect(await uploadsOf(m)).toBe(accepted);
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
	/** A Member with one stored photo (Recipes may share it, ADR 0006). */
	async function memberWithPhoto(username: string, opts: { isAdministrator?: boolean } = {}) {
		const m = await seedMember(username, opts);
		const key = (await (await upload(m)).res.json()).keys.detail as string;
		await db.delete(quotaUse).where(eq(quotaUse.memberId, m.id)); // the upload's own use is not under test
		return { m, key };
	}

	const publish = (as: TestMember, mainPhotoKey: string, title: string, extra: object = {}) =>
		call(as, 'POST', '/recipes', {
			title,
			mainPhotoKey,
			ingredients: [{ ingredientId: gin, mixRatio: 3 }],
			steps: ['注ぐ'],
			...extra
		});

	it('takes the last Recipe of the day, then answers 429 and creates nothing', async () => {
		const { m, key } = await memberWithPhoto('recipe_limit');
		for (let i = 0; i < RECIPE_LIMIT; i++)
			expect((await publish(m, key, `上限${i}${tag}`)).status).toBe(201);
		expect(await recipesOf(m)).toBe(RECIPE_LIMIT);

		const refused = await publish(m, key, `超過${tag}`);
		expect(refused.status).toBe(429);
		expect(await refused.json()).toEqual({ error: 'recipe_daily_limit' });
		expect(await recipesOf(m)).toBe(RECIPE_LIMIT);
		expect(await usesOf(m, 'recipe')).toBe(RECIPE_LIMIT);
	});

	it('takes the use before the slow work: publishes that arrive while the last one is in flight are refused', async () => {
		const { m, key } = await memberWithPhoto('recipe_race');
		await seedUses(m, 'recipe', RECIPE_LIMIT - 1);
		// A held lock on the photo makes every request that was accepted wait inside its transaction.
		const held = holdingTransaction((tx) =>
			tx
				.select()
				.from(photoUpload)
				.where(eq(photoUpload.id, key.split('/')[1]))
				.for('update')
		);
		try {
			await held.result;
			const first = publish(m, key, `競合0${tag}`);
			await waitForLockWaiters(1); // accepted, in its transaction, waiting for the photo
			const others = await Promise.all(
				Array.from({ length: 5 }, (_, i) => publish(m, key, `競合${i + 1}${tag}`))
			);
			expect(others.map((r) => r.status)).toEqual(Array(5).fill(429));
			held.commit();
			expect((await first).status).toBe(201);
		} finally {
			held.commit();
			await held.done;
		}
		expect(await recipesOf(m)).toBe(1);
		expect(await usesOf(m, 'recipe')).toBe(RECIPE_LIMIT);
	});

	it('gives the use back for a Recipe that was rejected, so a typo costs nothing', async () => {
		const { m, key } = await memberWithPhoto('recipe_typo');
		const bad = await call(m, 'POST', '/recipes', {
			title: `不正${tag}`,
			mainPhotoKey: key,
			ingredients: [{ ingredientId: randomUUID(), mixRatio: 3 }],
			steps: ['注ぐ']
		});
		expect(bad.status).toBe(422);
		expect(await usesOf(m, 'recipe')).toBe(0);
	});

	it('still answers a resent idempotency key with its Recipe at the limit, and does not count it', async () => {
		const { m, key } = await memberWithPhoto('recipe_resend');
		const idem = randomUUID();
		await seedUses(m, 'recipe', RECIPE_LIMIT - 1);

		const first = await publish(m, key, `再送${tag}`, { idempotencyKey: idem });
		expect(first.status).toBe(201);
		const again = await publish(m, key, `再送${tag}`, { idempotencyKey: idem });
		expect(again.status).toBe(201);
		expect(await again.json()).toEqual(await first.json());
		expect(await recipesOf(m)).toBe(1);
		expect(await usesOf(m, 'recipe')).toBe(RECIPE_LIMIT);
		// A different key is a new Recipe, which the limit refuses.
		expect((await publish(m, key, `別鍵${tag}`, { idempotencyKey: randomUUID() })).status).toBe(
			429
		);
	});

	it('does not count uses older than 24 hours, other Members, or edits', async () => {
		const { m, key } = await memberWithPhoto('recipe_window');
		await seedUses(m, 'recipe', RECIPE_LIMIT, 25);
		const made = await publish(m, key, `窓${tag}`);
		expect(made.status).toBe(201);

		await seedUses(m, 'recipe', RECIPE_LIMIT - 2); // 1 (new) + 8 = 9 in the window
		const edit = await call(m, 'PUT', `/recipes/${(await made.json()).id}`, {
			title: `窓改${tag}`,
			mainPhotoKey: key,
			ingredients: [{ ingredientId: gin, mixRatio: 3 }],
			steps: ['注ぐ']
		});
		expect(edit.status).toBe(200);
		expect(await usesOf(m, 'recipe')).toBe(RECIPE_LIMIT - 1 + RECIPE_LIMIT); // the edit added none

		await seedUses(m, 'recipe', 1); // m is now at the limit; another Member is not
		expect((await publish(m, key, `窓超過${tag}`)).status).toBe(429);
		const other = await memberWithPhoto('recipe_other');
		expect((await publish(other.m, other.key, `他人${tag}`)).status).toBe(201);
	});

	it('does not give a use back when the Recipes are deleted', async () => {
		const m = await seedMember('recipe_refund');
		for (let i = 0; i < RECIPE_LIMIT; i++) {
			// Deleting the Recipe releases its photo, so each one needs a new upload.
			const key = (await (await upload(m)).res.json()).keys.detail;
			const res = await publish(m, key, `返金${i}${tag}`);
			expect(res.status).toBe(201);
			expect((await call(m, 'DELETE', `/recipes/${(await res.json()).id}`)).status).toBe(204);
		}
		expect(await recipesOf(m)).toBe(0);
		const key = (await (await upload(m)).res.json()).keys.detail;
		expect((await publish(m, key, `返金超過${tag}`)).status).toBe(429);
	});

	it('counts an Administrator like any Member', async () => {
		const { m, key } = await memberWithPhoto('admin_recipe', { isAdministrator: true });
		await seedUses(m, 'recipe', RECIPE_LIMIT);
		expect((await publish(m, key, `管理者${tag}`)).status).toBe(429);
	});
});

describe('pruneAllQuotaUse', () => {
	it('deletes the rows of every Member that are older than 24 hours and keeps the rest', async () => {
		const [a, b] = [await seedMember('prune_a'), await seedMember('prune_b')];
		await seedUses(a, 'photo', 3, 25);
		await seedUses(b, 'recipe', 2, 48);
		await seedUses(a, 'recipe', 1, 23);
		expect(await pruneAllQuotaUse(db)).toBeGreaterThanOrEqual(5);
		expect(await usesOf(a, 'photo')).toBe(0);
		expect(await usesOf(b, 'recipe')).toBe(0);
		expect(await usesOf(a, 'recipe')).toBe(1);
	});
});

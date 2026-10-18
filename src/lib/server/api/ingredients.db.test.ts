import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, seedMember, type TestMember } from './test-helpers';

let admin: TestMember;
let alice: TestMember;
let noName: TestMember;
const tag = randomUUID().slice(0, 8);

beforeAll(async () => {
	admin = await seedMember('admin_ing', { isAdministrator: true });
	alice = await seedMember('alice_ing');
	noName = await seedMember(null);
});

describe('POST /api/ingredients', () => {
	it('401 signed out, 403 without a Username', async () => {
		const body = { name: `x${tag}`, abvPercent: 0 };
		expect((await call(null, 'POST', '/ingredients', body)).status).toBe(401);
		expect((await call(noName, 'POST', '/ingredients', body)).status).toBe(403);
	});

	it('400 for a malformed body', async () => {
		expect((await call(alice, 'POST', '/ingredients', { name: 1 })).status).toBe(400);
	});

	it('lets a Member register a 0% Ingredient (FR-012)', async () => {
		const res = await call(alice, 'POST', '/ingredients', {
			name: `ミント水${tag}`,
			abvPercent: 0
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ name: `ミント水${tag}`, abvPercent: 0 });
	});

	it('409 with similar names for a duplicate (FR-014)', async () => {
		await call(alice, 'POST', '/ingredients', { name: `シロップ${tag}`, abvPercent: 0 });
		const res = await call(alice, 'POST', '/ingredients', {
			name: `シロップ${tag}`,
			abvPercent: 0
		});
		expect(res.status).toBe(409);
		expect((await res.json()).similar[0].name).toBe(`シロップ${tag}`);
	});

	it('403 for a Member registering an alcoholic Ingredient, 201 for an Administrator (FR-013)', async () => {
		const body = { name: `リキュール${tag}`, abvPercent: 20 };
		expect((await call(alice, 'POST', '/ingredients', body)).status).toBe(403);
		const res = await call(admin, 'POST', '/ingredients', { ...body, isBaseSpirit: true });
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ abvPercent: 20, isBaseSpirit: true });
	});

	it('422 for an invalid ABV from an Administrator', async () => {
		const res = await call(admin, 'POST', '/ingredients', { name: `bad${tag}`, abvPercent: 150 });
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe('invalid_abv');
	});
});

describe('GET /api/ingredients/suggest', () => {
	it('is public and ranks the exact name first', async () => {
		await call(alice, 'POST', '/ingredients', { name: `サジェスト${tag}`, abvPercent: 0 });
		const res = await call(
			null,
			'GET',
			`/ingredients/suggest?name=${encodeURIComponent(`サジェスト${tag}`)}`
		);
		expect(res.status).toBe(200);
		expect((await res.json()).items[0].name).toBe(`サジェスト${tag}`);
	});

	it('400 without a name', async () => {
		expect((await call(null, 'GET', '/ingredients/suggest')).status).toBe(400);
	});
});

describe('PATCH /api/ingredients/:id/abv', () => {
	it('401 / 403 / 404 / 422 / 200 (FR-015)', async () => {
		const created = await call(admin, 'POST', '/ingredients', {
			name: `edit${tag}`,
			abvPercent: 10
		});
		const { id } = await created.json();
		const path = `/ingredients/${id}/abv`;

		expect((await call(null, 'PATCH', path, { abvPercent: 12 })).status).toBe(401);
		expect((await call(alice, 'PATCH', path, { abvPercent: 12 })).status).toBe(403);
		expect(
			(await call(admin, 'PATCH', '/ingredients/not-a-uuid/abv', { abvPercent: 12 })).status
		).toBe(404);
		expect(
			(await call(admin, 'PATCH', `/ingredients/${randomUUID()}/abv`, { abvPercent: 12 })).status
		).toBe(404);
		expect((await call(admin, 'PATCH', path, { abvPercent: 12.34 })).status).toBe(422);

		const ok = await call(admin, 'PATCH', path, { abvPercent: 12 });
		expect(ok.status).toBe(200);
		expect((await ok.json()).ingredient.abvPercent).toBe(12);
	});
});

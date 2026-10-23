import { isHttpError, isRedirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { ingredient, member, recipe, recipeIngredient, report } from '#lib/server/db/schema.js';
import { actions, load } from './+page.server';

const tag = randomUUID().slice(0, 8);
type Locals = App.Locals['member'];
let admin: Locals;
let plain: Locals;
let victim: { id: string; username: string };
let recipeId: string;
let reportId: string;

beforeAll(async () => {
	const [a, p, v] = await db
		.insert(member)
		.values([
			{ username: `adm_${tag}`, isAdministrator: true },
			{ username: `plain_${tag}` },
			{ username: `vic_${tag}` }
		])
		.returning();
	admin = { id: a.id, username: a.username, isAdministrator: true };
	plain = { id: p.id, username: p.username, isAdministrator: false };
	victim = { id: v.id, username: v.username! };
	const [r] = await db
		.insert(recipe)
		.values({
			memberId: v.id,
			title: `t${tag}`,
			mainPhotoKey: `recipe/${randomUUID()}/list.webp`
		})
		.returning();
	recipeId = r.id;
	const [rep] = await db
		.insert(report)
		.values({ recipeId: r.id, reporterId: p.id, reportedMemberId: v.id, reason: 'spam' })
		.returning();
	reportId = rep.id;
});

const form = (fields: Record<string, string>) =>
	new Request('http://localhost/admin', { method: 'POST', body: new URLSearchParams(fields) });
type ActionName = keyof typeof actions;
const act = (name: ActionName, as: Locals, fields: Record<string, string>) =>
	(actions[name] as (e: unknown) => Promise<unknown>)({
		locals: { member: as },
		request: form(fields)
	});
const loadAs = async (as: Locals, search = ''): Promise<unknown> =>
	await load({
		locals: { member: as },
		url: new URL(`http://localhost/admin${search}`)
	} as unknown as Parameters<typeof load>[0]);

const everyAction: [ActionName, Record<string, string>][] = [
	['setStatus', { id: randomUUID(), status: 'resolved' }],
	['deleteRecipe', { recipeId: randomUUID() }],
	['suspend', { username: 'nobody' }],
	['unsuspend', { username: 'nobody' }],
	['createIngredient', { name: 'x', abvPercent: '40' }],
	['updateAbv', { id: randomUUID(), abvPercent: '40' }],
	['deleteIngredient', { id: randomUUID() }]
];

describe('/admin authorization (FR-077)', () => {
	it('sends a signed-out visitor to the login page from the load and every action', async () => {
		for (const call of [
			() => loadAs(null),
			...everyAction.map(
				([n, f]) =>
					() =>
						act(n, null, f)
			)
		]) {
			const e = await call().catch((x: unknown) => x);
			expect(isRedirect(e) && e.status === 303 && e.location).toBe('/login');
		}
	});

	it('answers 403 to a Member who is not an Administrator, and changes nothing', async () => {
		for (const call of [
			() => loadAs(plain),
			...everyAction.map(
				([n, f]) =>
					() =>
						act(n, plain, f)
			),
			() => act('suspend', plain, { username: victim.username }),
			() => act('deleteRecipe', plain, { recipeId }),
			() => act('setStatus', plain, { id: reportId, status: 'dismissed' })
		]) {
			const e = await call().catch((x: unknown) => x);
			expect(isHttpError(e) && e.status).toBe(403);
		}
		const [m] = await db.select().from(member).where(eq(member.id, victim.id));
		expect(m.suspendedAt).toBeNull();
		expect(await db.select().from(recipe).where(eq(recipe.id, recipeId))).toHaveLength(1);
		expect((await db.select().from(report).where(eq(report.id, reportId)))[0].status).toBe('open');
	});
});

describe('/admin as an Administrator', () => {
	it('lists open Reports by default and switches by ?status', async () => {
		const ids = (d: unknown) => (d as { reports: { id: string }[] }).reports.map((r) => r.id);
		expect(ids(await loadAs(admin))).toContain(reportId);
		expect(ids(await loadAs(admin, '?status=resolved'))).not.toContain(reportId);
		expect(ids(await loadAs(admin, '?status=all'))).toContain(reportId);
		expect(await loadAs(admin, '?status=bogus')).toMatchObject({ status: 'open' });
	});

	it('shows the first page for a malformed ?cursor instead of failing', async () => {
		const ok = await loadAs(admin, '?status=all');
		expect(await loadAs(admin, '?status=all&cursor=garbage')).toEqual(ok);
		const impossible = Buffer.from(
			JSON.stringify(['2031-02-30 00:00:00+00', randomUUID()])
		).toString('base64url');
		expect(await loadAs(admin, `?status=all&cursor=${impossible}`)).toEqual(ok);
	});

	it('follows nextCursor to the next page and keeps the status', async () => {
		const reporters = await db
			.insert(member)
			.values(Array.from({ length: 52 }, (_, i) => ({ username: `pg${i}_${tag}` })))
			.returning({ id: member.id });
		await db.insert(report).values(
			reporters.map((m) => ({
				recipeId,
				reporterId: m.id,
				reportedMemberId: victim.id,
				reason: 'spam' as const,
				status: 'dismissed' as const
			}))
		);
		type Page = {
			status: string;
			reports: { id: string; status: string }[];
			nextCursor: string | null;
		};
		const p1 = (await loadAs(admin, '?status=dismissed')) as Page;
		expect(p1.nextCursor).not.toBeNull();
		const p2 = (await loadAs(
			admin,
			`?status=dismissed&cursor=${encodeURIComponent(p1.nextCursor!)}`
		)) as Page;
		expect(p2.status).toBe('dismissed');
		expect(p2.reports.length).toBeGreaterThan(0);
		expect(p2.reports.every((r) => r.status === 'dismissed')).toBe(true);
		const seen = new Set(p1.reports.map((r) => r.id));
		expect(p2.reports.some((r) => seen.has(r.id))).toBe(false);
	});

	it('changes status, suspends and lifts, rejects a malformed Ingredient id without a 500', async () => {
		expect(await act('setStatus', admin, { id: reportId, status: 'resolved' })).toBeUndefined();
		expect((await db.select().from(report).where(eq(report.id, reportId)))[0].status).toBe(
			'resolved'
		);
		await act('suspend', admin, { username: victim.username });
		expect(
			(await db.select().from(member).where(eq(member.id, victim.id)))[0].suspendedAt
		).not.toBeNull();
		await act('unsuspend', admin, { username: victim.username });
		expect(
			(await db.select().from(member).where(eq(member.id, victim.id)))[0].suspendedAt
		).toBeNull();
		expect(await act('updateAbv', admin, { id: 'not-a-uuid', abvPercent: '40' })).toMatchObject({
			status: 400
		});
	});
});

describe('/admin Ingredient deletion (#64)', () => {
	const exists = async (id: string) =>
		(await db.select().from(ingredient).where(eq(ingredient.id, id))).length === 1;
	const zero = async (name: string) =>
		(
			await db
				.insert(ingredient)
				.values({ name: `${name}${tag}`, abvPercent: 0 })
				.returning()
		)[0].id;

	it('deletes an unused 0% Ingredient only for an Administrator', async () => {
		const id = await zero('管理削除');
		const e = await act('deleteIngredient', plain, { id }).catch((x: unknown) => x);
		expect(isHttpError(e) && e.status).toBe(403);
		expect(await exists(id)).toBe(true);

		expect(await act('deleteIngredient', admin, { id })).toBeUndefined();
		expect(await exists(id)).toBe(false);
	});

	it('shows an error and keeps an Ingredient that a Recipe uses', async () => {
		const id = await zero('管理使用中');
		await db
			.insert(recipeIngredient)
			.values({ recipeId, ingredientId: id, mixRatio: 1, position: 1 });
		const r = (await act('deleteIngredient', admin, { id })) as {
			status: number;
			data: { error: string };
		};
		expect(r.status).toBe(400);
		expect(r.data.error).toContain('使われている');
		expect(await exists(id)).toBe(true);
		const listed = (
			(await loadAs(admin)) as { ingredients: { id: string; inUse: boolean }[] }
		).ingredients.find((i) => i.id === id);
		expect(listed?.inUse).toBe(true);
	});

	it('answers an unknown or malformed id with an error, not a 500', async () => {
		for (const id of [randomUUID(), 'not-a-uuid', ''])
			expect(await act('deleteIngredient', admin, { id })).toMatchObject({ status: 400 });
	});
});

import { isHttpError, isRedirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { member, recipe, report } from '#lib/server/db/schema.js';
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
	['updateAbv', { id: randomUUID(), abvPercent: '40' }]
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

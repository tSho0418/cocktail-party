import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { member, recipe, report } from '#lib/server/db/schema.js';
import { actions } from './+page.server';

const tag = randomUUID().slice(0, 8);
let author: { id: string };
let reporter: NonNullable<App.Locals['member']>;
let recipeId: string;

beforeAll(async () => {
	const [a, r] = await db
		.insert(member)
		.values([{ username: `au_${tag}` }, { username: `rp_${tag}` }])
		.returning();
	author = a;
	reporter = { id: r.id, username: r.username, isAdministrator: false };
	const [rec] = await db
		.insert(recipe)
		.values({ memberId: a.id, title: 't', mainPhotoKey: `recipe/${randomUUID()}/list.webp` })
		.returning();
	recipeId = rec.id;
});

const send = (as: App.Locals['member'], fields: Record<string, string>) =>
	(actions.report as (e: unknown) => Promise<unknown>)({
		locals: { member: as },
		params: { id: recipeId },
		request: new Request('http://localhost/', { method: 'POST', body: new URLSearchParams(fields) })
	});

describe('?/report action (FR-070/071)', () => {
	it('refuses a signed-out visitor and a Member without a Username', async () => {
		expect(await send(null, { reason: 'spam' })).toMatchObject({ status: 401 });
		expect(await send({ ...reporter, username: null }, { reason: 'spam' })).toMatchObject({
			status: 401
		});
		expect(await db.select().from(report).where(eq(report.recipeId, recipeId))).toEqual([]);
	});

	it('records one Report, then explains a repeat, a bad reason and a long note', async () => {
		expect(await send(reporter, { reason: 'plagiarism', detail: ' 盗用 ' })).toEqual({
			reported: true
		});
		const [row] = await db.select().from(report).where(eq(report.recipeId, recipeId));
		expect(row).toMatchObject({
			reason: 'plagiarism',
			detail: '盗用',
			reporterId: reporter.id,
			reportedMemberId: author.id
		});
		expect(await send(reporter, { reason: 'spam' })).toMatchObject({ status: 400 });
		expect(await send(reporter, { reason: 'rude' })).toMatchObject({ status: 400 });
		expect(await send(reporter, { reason: 'spam', detail: 'あ'.repeat(201) })).toMatchObject({
			status: 400
		});
		expect(await db.select().from(report).where(eq(report.recipeId, recipeId))).toHaveLength(1);
	});
});

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { like, member, recipe, report, save } from '#lib/server/db/schema.js';
import { deleteObjects } from '#lib/server/services/images/delete-objects.js';
import { actions, load } from './+page.server';

vi.mock('#lib/server/services/images/delete-objects.js', () => ({ deleteObjects: vi.fn() }));

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

describe('detail load: what the viewer may do (FR-008/055/056/074)', () => {
	let other: NonNullable<App.Locals['member']>;
	let admin: NonNullable<App.Locals['member']>;
	let owner: NonNullable<App.Locals['member']>;

	const view = (as: App.Locals['member']) =>
		(load as (e: unknown) => Promise<Record<string, unknown>>)({
			params: { id: recipeId },
			locals: { member: as }
		});

	beforeAll(async () => {
		const [o, a] = await db
			.insert(member)
			.values([{ username: `ot_${tag}` }, { username: `ad_${tag}`, isAdministrator: true }])
			.returning();
		other = { id: o.id, username: o.username, isAdministrator: false };
		admin = { id: a.id, username: a.username, isAdministrator: true };
		owner = { id: author.id, username: `au_${tag}`, isAdministrator: false };
		await db.insert(like).values({ memberId: other.id, recipeId });
		await db.insert(save).values({ memberId: other.id, recipeId });
	});

	it('shows a signed-out visitor the count only', async () => {
		expect(await view(null)).toMatchObject({
			signedIn: false,
			isOwner: false,
			canEdit: false,
			canDelete: false,
			reactions: { likeCount: 1, liked: false, saved: false }
		});
	});

	it('gives another Member their own Like/Save state and no edit or delete', async () => {
		expect(await view(other)).toMatchObject({
			signedIn: true,
			canEdit: false,
			canDelete: false,
			reactions: { likeCount: 1, liked: true, saved: true }
		});
		expect(await view({ ...other, username: null })).toMatchObject({
			signedIn: false,
			canDelete: false,
			reactions: { liked: false, saved: false }
		});
	});

	it('lets the owner edit and delete, and keeps their Save private', async () => {
		expect(await view(owner)).toMatchObject({
			signedIn: true,
			isOwner: true,
			canEdit: true,
			canDelete: true,
			reactions: { likeCount: 1, liked: false, saved: false }
		});
	});

	it('lets an Administrator delete but not edit', async () => {
		expect(await view(admin)).toMatchObject({ canEdit: false, canDelete: true });
	});

	it('does not treat the owner as owner while they have no Username', async () => {
		expect(await view({ ...owner, username: null })).toMatchObject({
			isOwner: false,
			canEdit: false,
			canDelete: false
		});
	});
});

describe('?/delete action (FR-008/074)', () => {
	let target: string;
	let key: string;
	let stranger: NonNullable<App.Locals['member']>;
	let admin: NonNullable<App.Locals['member']>;

	const del = (as: App.Locals['member']) =>
		(actions.delete as (e: unknown) => Promise<unknown>)({
			locals: { member: as },
			params: { id: target }
		});
	const exists = async () =>
		(await db.select().from(recipe).where(eq(recipe.id, target))).length === 1;

	beforeAll(async () => {
		const [s, a] = await db
			.insert(member)
			.values([{ username: `st_${tag}` }, { username: `da_${tag}`, isAdministrator: true }])
			.returning();
		stranger = { id: s.id, username: s.username, isAdministrator: false };
		admin = { id: a.id, username: a.username, isAdministrator: true };
	});

	const seed = async () => {
		key = `recipe/${randomUUID()}/list.webp`;
		const [rec] = await db
			.insert(recipe)
			.values({ memberId: author.id, title: 'del', mainPhotoKey: key })
			.returning();
		target = rec.id;
		await db.insert(like).values({ memberId: stranger.id, recipeId: target });
		await db.insert(save).values({ memberId: stranger.id, recipeId: target });
	};

	it('refuses a signed-out visitor and someone who is neither owner nor Administrator', async () => {
		await seed();
		vi.mocked(deleteObjects).mockClear();
		expect(await del(null)).toMatchObject({ status: 401 });
		expect(await del({ ...stranger, username: null })).toMatchObject({ status: 401 });
		expect(
			await (actions.delete as (e: unknown) => Promise<unknown>)({
				locals: { member: stranger },
				params: { id: 'not-a-uuid' }
			})
		).toMatchObject({ status: 404 });
		expect(await del(stranger)).toMatchObject({ status: 403 });
		expect(await exists()).toBe(true);
		expect(deleteObjects).not.toHaveBeenCalled();
	});

	it('deletes for the owner with its Likes, Saves and photos, then goes to the top', async () => {
		vi.mocked(deleteObjects).mockClear();
		// Keys go to storage only after the commit: the row is already gone by then.
		vi.mocked(deleteObjects).mockImplementationOnce(async () => {
			expect(await exists()).toBe(false);
		});
		const owner = { id: author.id, username: `au_${tag}`, isAdministrator: false };
		const e = await del(owner).catch((x) => x);
		expect(isRedirect(e) && e.location).toBe('/');
		expect(await exists()).toBe(false);
		expect(await db.select().from(like).where(eq(like.recipeId, target))).toEqual([]);
		expect(await db.select().from(save).where(eq(save.recipeId, target))).toEqual([]);
		expect(await del(owner)).toMatchObject({ status: 404 });
		expect(vi.mocked(deleteObjects).mock.calls[0][1]).toContain(key);
	});

	it('deletes for an Administrator', async () => {
		await seed();
		vi.mocked(deleteObjects).mockClear();
		const e = await del(admin).catch((x) => x);
		expect(isRedirect(e)).toBe(true);
		expect(await exists()).toBe(false);
		expect(vi.mocked(deleteObjects).mock.calls[0][1]).toContain(key);
	});
});

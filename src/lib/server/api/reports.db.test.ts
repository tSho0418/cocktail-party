import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { follow, recipe, report } from '#lib/server/db/schema.js';
import { getRecipeDetail, searchRecipes } from '#lib/server/services/recipes/index.js';
import { withdrawMember } from '#lib/server/services/members/index.js';
import { getProfile, listFollowing } from '#lib/server/services/social/index.js';
import { listReports } from '#lib/server/services/reports/index.js';
import { call, seedMember, type TestMember } from './test-helpers';

let n = 0;
const uniq = () => `rp${Date.now().toString(36)}${++n}`.slice(0, 20);
const actorOf = (m: TestMember) => ({ memberId: m.id, isAdministrator: m.isAdministrator });

async function newRecipe(owner: TestMember, title = 'テスト') {
	const key = `recipe/${crypto.randomUUID()}/list.webp`;
	const [r] = await db
		.insert(recipe)
		.values({ memberId: owner.id, title, searchText: title, mainPhotoKey: key })
		.returning();
	return r.id;
}

const reportRow = async (id: string) =>
	(await db.select().from(report).where(eq(report.id, id)))[0];

describe('POST /api/recipes/:id/reports (FR-070/071)', () => {
	it('records a Report once per Member and Recipe; a different Member may also report', async () => {
		const author = await seedMember(uniq());
		const a = await seedMember(uniq());
		const b = await seedMember(uniq());
		const id = await newRecipe(author);

		const first = await call(a, 'POST', `/recipes/${id}/reports`, {
			reason: 'spam',
			detail: ' 広告です '
		});
		expect(first.status).toBe(201);
		const row = await reportRow((await first.json()).id);
		expect(row).toMatchObject({
			status: 'open',
			reason: 'spam',
			detail: '広告です',
			reporterId: a.id,
			reportedMemberId: author.id
		});

		const again = await call(a, 'POST', `/recipes/${id}/reports`, { reason: 'other' });
		expect(again.status).toBe(409);
		expect((await again.json()).error).toBe('duplicate');
		expect((await call(b, 'POST', `/recipes/${id}/reports`, { reason: 'other' })).status).toBe(201);
	});

	it('rejects signed-out callers, unknown reasons, long details and missing or hidden Recipes', async () => {
		const author = await seedMember(uniq());
		const a = await seedMember(uniq());
		const id = await newRecipe(author);

		expect((await call(null, 'POST', `/recipes/${id}/reports`, { reason: 'spam' })).status).toBe(
			401
		);
		expect((await call(a, 'POST', `/recipes/${id}/reports`, { reason: 'rude' })).status).toBe(422);
		const long = await call(a, 'POST', `/recipes/${id}/reports`, {
			reason: 'spam',
			detail: 'あ'.repeat(201)
		});
		expect(long.status).toBe(422);
		expect(
			(
				await call(a, 'POST', `/recipes/${id}/reports`, {
					reason: 'spam',
					detail: 'あ'.repeat(200)
				})
			).status
		).toBe(201);

		const gone = crypto.randomUUID();
		expect((await call(a, 'POST', `/recipes/${gone}/reports`, { reason: 'spam' })).status).toBe(
			404
		);
		expect((await call(a, 'POST', '/recipes/not-a-uuid/reports', { reason: 'spam' })).status).toBe(
			404
		);

		const admin = await seedMember(uniq(), { isAdministrator: true });
		await call(admin, 'PUT', `/admin/members/${author.username}/suspension`);
		const hidden = await call(a, 'POST', `/recipes/${id}/reports`, { reason: 'other' });
		expect(hidden.status).toBe(404);
	});
});

describe('concurrent duplicate Reports (FR-071)', () => {
	it('lets exactly one of two simultaneous POSTs through, the other is 409, never 500', async () => {
		const author = await seedMember(uniq());
		const a = await seedMember(uniq());
		const id = await newRecipe(author);
		const statuses = (
			await Promise.all(
				Array.from({ length: 4 }, () =>
					call(a, 'POST', `/recipes/${id}/reports`, { reason: 'spam' })
				)
			)
		)
			.map((r) => r.status)
			.sort();
		expect(statuses).toEqual([201, 409, 409, 409]);
		expect(await db.select().from(report).where(eq(report.recipeId, id))).toHaveLength(1);
	});
});

describe('administrator routes (FR-072/073/075)', () => {
	it('refuse signed-out callers and Members who are not Administrators', async () => {
		const m = await seedMember(uniq());
		const target = await seedMember(uniq());
		for (const as of [null, m]) {
			const expected = as ? 403 : 401;
			expect((await call(as, 'GET', '/admin/reports')).status).toBe(expected);
			expect(
				(await call(as, 'PATCH', `/admin/reports/${crypto.randomUUID()}`, { status: 'resolved' }))
					.status
			).toBe(expected);
			expect((await call(as, 'PUT', `/admin/members/${target.username}/suspension`)).status).toBe(
				expected
			);
			expect(
				(await call(as, 'DELETE', `/admin/members/${target.username}/suspension`)).status
			).toBe(expected);
			expect((await call(as, 'GET', '/admin/suspensions')).status).toBe(expected);
		}
		expect(await getProfile(db, target.username!, null)).not.toBeNull();
	});

	it('list Reports with sender and author, and change the status', async () => {
		const admin = await seedMember(uniq(), { isAdministrator: true });
		const author = await seedMember(uniq());
		const a = await seedMember(uniq());
		const id = await newRecipe(author);
		const { id: reportId } = await (
			await call(a, 'POST', `/recipes/${id}/reports`, { reason: 'plagiarism' })
		).json();

		const listed = await (await call(admin, 'GET', '/admin/reports')).json();
		expect(listed.items.find((r: { id: string }) => r.id === reportId)).toMatchObject({
			status: 'open',
			reason: 'plagiarism',
			targetState: 'live',
			recipeTitle: 'テスト',
			reporterUsername: a.username,
			reportedUsername: author.username
		});

		expect(
			(await call(admin, 'PATCH', `/admin/reports/${reportId}`, { status: 'resolved' })).status
		).toBe(200);
		expect((await reportRow(reportId)).status).toBe('resolved');
		expect(
			(await call(admin, 'PATCH', `/admin/reports/${reportId}`, { status: 'done' })).status
		).toBe(422);
		const open = await (await call(admin, 'GET', '/admin/reports?status=open')).json();
		expect(open.items.some((r: { id: string }) => r.id === reportId)).toBe(false);
	});
});

describe('Recipe deletion and withdrawal keep Reports (FR-074/078)', () => {
	it('an Administrator deletes the Recipe; the Report stays as a record', async () => {
		const admin = await seedMember(uniq(), { isAdministrator: true });
		const author = await seedMember(uniq());
		const a = await seedMember(uniq());
		const id = await newRecipe(author);
		const { id: reportId } = await (
			await call(a, 'POST', `/recipes/${id}/reports`, { reason: 'spam' })
		).json();

		expect((await call(a, 'DELETE', `/recipes/${id}`)).status).toBe(403);
		expect((await call(admin, 'DELETE', `/recipes/${id}`)).status).toBe(204);

		expect(await getRecipeDetail(db, id)).toBeNull();
		expect(await reportRow(reportId)).toMatchObject({
			recipeId: null,
			targetState: 'recipe_deleted',
			reporterId: a.id,
			reportedMemberId: author.id
		});
		const rows = await listReports(db, actorOf(admin));
		expect(rows.ok && rows.value.find((r) => r.id === reportId)).toMatchObject({
			targetState: 'recipe_deleted',
			recipeTitle: null,
			reportedUsername: author.username
		});
	});

	it('withdrawal: received Reports become 退会済み without Recipe data, sent Reports lose the sender', async () => {
		const admin = await seedMember(uniq(), { isAdministrator: true });
		const leaver = await seedMember(uniq());
		const other = await seedMember(uniq());
		const mine = await newRecipe(leaver);
		const theirs = await newRecipe(other);
		const received = (
			await (await call(other, 'POST', `/recipes/${mine}/reports`, { reason: 'spam' })).json()
		).id;
		const sent = (
			await (await call(leaver, 'POST', `/recipes/${theirs}/reports`, { reason: 'other' })).json()
		).id;

		await withdrawMember({ id: leaver.id });

		const rows = await listReports(db, actorOf(admin));
		const by = (id: string) => rows.ok && rows.value.find((r) => r.id === id);
		expect(by(received)).toMatchObject({
			targetState: 'member_withdrawn',
			recipeId: null,
			recipeTitle: null,
			reportedUsername: null,
			reporterUsername: other.username
		});
		expect(by(sent)).toMatchObject({
			targetState: 'live',
			recipeTitle: 'テスト',
			reporterUsername: null,
			reportedUsername: other.username
		});
	});
});

describe('Suspension (FR-075)', () => {
	it('hides the Member everywhere until it is lifted', async () => {
		const admin = await seedMember(uniq(), { isAdministrator: true });
		const bad = await seedMember(uniq());
		const fan = await seedMember(uniq());
		const title = uniq();
		const id = await newRecipe(bad, title);
		await db.insert(follow).values({ followerId: fan.id, followeeId: bad.id });
		const inSearch = async () => {
			const r = await searchRecipes(db, { keyword: title, limit: 50 });
			return r.ok && r.value.items.some((x) => x.id === id);
		};
		const visible = async () => ({
			detail: !!(await getRecipeDetail(db, id)),
			profile: !!(await getProfile(db, bad.username!, null)),
			listed: await inSearch(),
			following: (await listFollowing(db, fan.id)).items.length
		});
		expect(await visible()).toEqual({ detail: true, profile: true, listed: true, following: 1 });

		expect((await call(admin, 'PUT', `/admin/members/${bad.username}/suspension`)).status).toBe(
			200
		);
		expect(await visible()).toEqual({ detail: false, profile: false, listed: false, following: 0 });
		const suspended = await (await call(admin, 'GET', '/admin/suspensions')).json();
		expect(suspended.items.map((m: { id: string }) => m.id)).toContain(bad.id);

		expect((await call(admin, 'DELETE', `/admin/members/${bad.username}/suspension`)).status).toBe(
			200
		);
		expect(await visible()).toEqual({ detail: true, profile: true, listed: true, following: 1 });
	});

	it('answers 404 for an unknown Member and refuses suspending oneself', async () => {
		const admin = await seedMember(uniq(), { isAdministrator: true });
		expect((await call(admin, 'PUT', `/admin/members/${uniq()}/suspension`)).status).toBe(404);
		const self = await call(admin, 'PUT', `/admin/members/${admin.username}/suspension`);
		expect(self.status).toBe(422);
		expect(await getProfile(db, admin.username!, null)).not.toBeNull();
	});
});

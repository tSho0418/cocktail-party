import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pool, seedIngredient, seedRecipe, signIn, signedInContext } from './signed-in';

const tag = randomUUID().slice(0, 8);
const gin = `E2E通報ジン${tag}`;
const tonic = `E2E通報トニック${tag}`;
const title = `E2E通報レシピ${tag}`;
let recipeId: string;
const memberIds: string[] = [];

const REASONS = [
	['inappropriate_photo', '不適切な画像'],
	['plagiarism', '他人の写真・レシピの盗用'],
	['spam', 'スパム'],
	['other', 'その他']
] as const;

test.beforeAll(async ({ browser, baseURL }) => {
	// Leftovers of a run that was killed before its afterAll. Own prefix: the other specs run in parallel.
	await cleanUp(
		(await pool.query(`select id from member where username like 'e2e\\_rpt\\_%'`)).rows.map(
			(r) => r.id
		)
	);
	await pool.query(`delete from ingredient where name like 'E2E通報%'`);
	await seedIngredient(gin, 40);
	await seedIngredient(tonic, 0);
	const owner = await signedInContext(browser, baseURL, `e2e_rpt_own_${tag}`);
	memberIds.push(owner.memberId);
	recipeId = await seedRecipe(owner.context, owner.memberId, {
		title,
		ingredients: [
			{ name: gin, mixRatio: 1 },
			{ name: tonic, mixRatio: 3 }
		]
	});
	await owner.context.close();
});

// Reports first: they outlive both their Recipe and their reporter, so deleting the Members would orphan them.
async function cleanUp(ids: string[]) {
	await pool.query(
		`delete from report where reporter_id = any($1) or reported_member_id = any($1)`,
		[ids]
	);
	await pool.query(`delete from recipe where member_id = any($1)`, [ids]);
	await pool.query(`delete from member where id = any($1)`, [ids]);
}

test.afterAll(async () => {
	await cleanUp(memberIds);
	await pool.query(`delete from ingredient where name = any($1)`, [[gin, tonic]]);
	await pool.end();
});

const reportsOf = async (reporterId: string) =>
	(
		await pool.query(
			`select reason, detail from report where reporter_id = $1 and recipe_id = $2`,
			[reporterId, recipeId]
		)
	).rows;

for (const [reason, label] of REASONS) {
	test(`a Member reports a Recipe as ${reason} (FR-070)`, async ({ page, context }) => {
		const reporterId = await signIn(context, `e2e_rpt_${reason.slice(0, 3)}_${tag}`);
		memberIds.push(reporterId);
		await page.goto(`/recipes/${recipeId}`);
		await page.getByText('このレシピを通報する').click();
		await page.getByLabel(label, { exact: true }).check();
		await page.getByRole('button', { name: '通報する' }).click();
		await expect(page.getByRole('status')).toContainText('通報を受け付けました');
		expect(await reportsOf(reporterId)).toEqual([{ reason, detail: null }]);
	});
}

test('the whole Report flow works from the keyboard, and the note stops at 200 characters (NFR-005, FR-070)', async ({
	page,
	context
}) => {
	const reporterId = await signIn(context, `e2e_rpt_kbd_${tag}`);
	memberIds.push(reporterId);
	await page.goto(`/recipes/${recipeId}`);
	await page.locator('summary').focus();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab'); // the first reason
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown'); // スパム
	await page.keyboard.press('Tab');
	await page.keyboard.type('あ'.repeat(230));
	await expect(page.getByLabel('補足', { exact: false })).toHaveValue('あ'.repeat(200));
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status')).toContainText('通報を受け付けました');
	// The form that had focus is gone; focus moves to the confirmation instead of the top of the page.
	await expect(page.getByRole('status')).toBeFocused();
	expect(await reportsOf(reporterId)).toEqual([{ reason: 'spam', detail: 'あ'.repeat(200) }]);
});

test('reporting the same Recipe twice is refused and stays a single Report (FR-071)', async ({
	page,
	context
}) => {
	const reporterId = await signIn(context, `e2e_rpt_dup_${tag}`);
	memberIds.push(reporterId);
	for (const attempt of [1, 2]) {
		await page.goto(`/recipes/${recipeId}`);
		await page.getByText('このレシピを通報する').click();
		await page.getByLabel('スパム', { exact: true }).check();
		await page.getByRole('button', { name: '通報する' }).click();
		if (attempt === 1) await expect(page.getByRole('status')).toBeVisible();
		else await expect(page.getByRole('alert')).toContainText('すでに通報しています');
	}
	expect(await reportsOf(reporterId)).toHaveLength(1);
});

test('a note over 200 characters sent past the form is refused (FR-070)', async ({
	page,
	context
}) => {
	const reporterId = await signIn(context, `e2e_rpt_lng_${tag}`);
	memberIds.push(reporterId);
	await page.goto(`/recipes/${recipeId}`);
	await page.getByText('このレシピを通報する').click();
	await page.getByLabel('スパム', { exact: true }).check();
	// maxlength stops typing, not a tampered form.
	await page
		.getByLabel('補足', { exact: false })
		.evaluate((e: HTMLTextAreaElement) => e.removeAttribute('maxlength'));
	await page.getByLabel('補足', { exact: false }).fill('あ'.repeat(201));
	await page.getByRole('button', { name: '通報する' }).click();
	await expect(page.getByRole('alert')).toContainText('200 字まで');
	expect(await reportsOf(reporterId)).toEqual([]);
});

test('a signed-out visitor does not see the Report form', async ({ page }) => {
	await page.goto(`/recipes/${recipeId}`);
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await expect(page.getByText('このレシピを通報する')).toHaveCount(0);
});

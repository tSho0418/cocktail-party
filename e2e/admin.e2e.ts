import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { pool, seedIngredient, seedRecipe, signIn, signedInContext } from './signed-in';

const tag = randomUUID().slice(0, 8);
const gin = `E2E管理ジン${tag}`;
const water = `E2E管理水${tag}`;
const memberIds: string[] = [];
let adminId: string;
const ingredientNames: string[] = [];
let n = 0;

test.beforeAll(async () => {
	// Leftovers of a run that was killed before its afterAll. Own prefix: the other specs run in parallel.
	await cleanUp(
		(await pool.query(`select id from member where username like 'e2e\\_adm\\_%'`)).rows.map(
			(r) => r.id
		)
	);
	await pool.query(`delete from ingredient where name like 'E2E管理%'`);
	await seedIngredient(gin, 40);
	await seedIngredient(water, 0);
	ingredientNames.push(gin, water);
});

// Reports first: they outlive both their Recipe and their Members, so deleting the Members would orphan them.
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
	await pool.query(`delete from ingredient where name = any($1)`, [ingredientNames]);
});

/** The signed-in Administrator of this test. */
test.beforeEach(async ({ context }) => {
	adminId = await signIn(context, `e2e_adm_a${++n}_${tag}`);
	memberIds.push(adminId);
	await pool.query(`update member set is_administrator = true where id = $1`, [adminId]);
});

/** A Recipe by a fresh author, reported once by a fresh reporter; `note` finds its row on /admin. */
async function seedReport(
	browser: Browser,
	baseURL: string | undefined,
	note = `メモ${randomUUID().slice(0, 8)}`
) {
	const authorName = `e2e_adm_w${++n}_${tag}`;
	const author = await signedInContext(browser, baseURL, authorName);
	memberIds.push(author.memberId);
	try {
		const recipeId = await seedRecipe(author.context, author.memberId, {
			title: `E2E管理レシピ${randomUUID().slice(0, 8)}`,
			ingredients: [
				{ name: gin, mixRatio: 1 },
				{ name: water, mixRatio: 1 }
			]
		});
		const authorState = await author.context.storageState();
		const reporterId: string = (
			await pool.query(`insert into member (username) values ($1) returning id`, [
				`e2e_adm_r${++n}_${tag}`
			])
		).rows[0].id;
		memberIds.push(reporterId);
		await pool.query(
			`insert into report (recipe_id, reporter_id, reported_member_id, reason, detail) values ($1, $2, $3, 'spam', $4)`,
			[recipeId, reporterId, author.memberId, note]
		);
		return { recipeId, authorName, authorId: author.memberId, authorState, note };
	} finally {
		await author.context.close();
	}
}

const row = (page: Page, note: string) =>
	page.locator('section[aria-labelledby=reports-heading] li').filter({ hasText: note });

test('a Report moves between status filters, and an action keeps the filter you are on (FR-072/073)', async ({
	page,
	browser,
	baseURL
}) => {
	const { note } = await seedReport(browser, baseURL);
	await page.goto('/admin');
	await expect(row(page, note)).toContainText('未対応');

	await row(page, note).getByLabel('状態').selectOption('resolved');
	await row(page, note).getByRole('button', { name: '状態を変更' }).click();
	await expect(row(page, note)).toHaveCount(0); // no longer 未対応

	await page.getByRole('link', { name: '対応済み' }).click();
	await expect(row(page, note)).toContainText('対応済み');

	// An action on this filtered view must not throw you back to 未対応.
	await row(page, note).getByLabel('状態').selectOption('dismissed');
	await row(page, note).getByRole('button', { name: '状態を変更' }).click();
	await expect(row(page, note)).toHaveCount(0);
	await expect(page).toHaveURL(/status=resolved/);
	await expect(page.getByRole('link', { name: '対応済み' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.getByRole('link', { name: '却下' }).click();
	await expect(row(page, note)).toContainText('却下');
});

test('Report status can be changed from the keyboard (NFR-005)', async ({
	page,
	browser,
	baseURL
}) => {
	const { note } = await seedReport(browser, baseURL);
	await page.goto('/admin');
	await row(page, note).getByLabel('状態').focus();
	await page.keyboard.press('ArrowDown'); // 未対応 -> 対応済み
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	await expect(row(page, note)).toHaveCount(0);
	const [{ status }] = (await pool.query(`select status from report where detail = $1`, [note]))
		.rows;
	expect(status).toBe('resolved');
});

test('deleting the Recipe removes it but keeps the Report as a record (FR-074)', async ({
	page,
	browser,
	baseURL
}) => {
	const { note, recipeId } = await seedReport(browser, baseURL);
	await page.goto('/admin');
	// Nothing is deleted until the confirmation is opened and confirmed.
	await row(page, note).getByText('レシピを削除する').click();
	await expect(row(page, note)).toContainText('投稿者には通知されません');
	await expect(row(page, note)).toContainText('Report は記録として残ります');
	expect((await page.request.get(`/recipes/${recipeId}`)).status()).toBe(200);
	await row(page, note).getByRole('button', { name: '削除を確定する' }).click();
	await expect(row(page, note)).toContainText('削除済みのレシピ');
	await expect(row(page, note).getByText('レシピを削除する')).toHaveCount(0);
	expect((await page.request.get(`/recipes/${recipeId}`)).status()).toBe(404);
	expect((await pool.query(`select 1 from report where detail = $1`, [note])).rowCount).toBe(1);
});

test('Suspension hides the author, logs them out, and lifting it brings the Recipe back (FR-075)', async ({
	page,
	browser,
	baseURL
}) => {
	const { note, recipeId, authorName, authorId, authorState } = await seedReport(browser, baseURL);
	const visible = async () => (await page.request.get(`/recipes/${recipeId}`)).status();
	expect(await visible()).toBe(200);

	await page.goto('/admin');
	await row(page, note).getByRole('button', { name: '投稿者を停止' }).click();
	await expect(row(page, note)).toContainText('停止中');
	await expect(page.locator('section[aria-labelledby=suspension-heading]')).toContainText(
		authorName
	);
	expect(await visible()).toBe(404);
	// The author's own session is revoked the next time it is used.
	const sessions = async () =>
		(await pool.query(`select 1 from session where user_id = $1`, [authorId])).rowCount;
	expect(await sessions()).toBe(1);
	const authorContext = await browser.newContext({ baseURL, storageState: authorState });
	await authorContext.request.get('/');
	await authorContext.close();
	expect(await sessions()).toBe(0);

	await row(page, note).getByRole('button', { name: '停止を解除' }).click();
	await expect(row(page, note)).not.toContainText('停止中');
	await expect(page.locator('section[aria-labelledby=suspension-heading]')).not.toContainText(
		authorName
	);
	expect(await visible()).toBe(200);

	// By name, from the list: case does not matter, and the list's own button lifts it again.
	await page.getByLabel('Username', { exact: true }).fill(authorName.toUpperCase());
	await page.getByRole('button', { name: '停止する' }).click();
	const list = page.locator('section[aria-labelledby=suspension-heading]');
	await expect(list).toContainText(authorName);
	expect(await visible()).toBe(404);
	await list.getByRole('button', { name: '解除' }).click();
	await expect(list).not.toContainText(authorName);
	expect(await visible()).toBe(200);
	expect(
		(await pool.query(`select suspended_at from member where id = $1`, [authorId])).rows[0]
			.suspended_at
	).toBeNull();
});

test('Suspension refuses yourself and unknown names with a message (FR-075)', async ({ page }) => {
	await page.goto('/admin');
	const username = page.getByLabel('Username', { exact: true });
	await username.fill('e2e_adm_nobody');
	await page.getByRole('button', { name: '停止する' }).click();
	await expect(page.getByRole('alert')).toContainText('見つかりませんでした');
	const self = (await pool.query(`select username from member where id = $1`, [adminId])).rows[0]
		.username;
	await username.fill(self);
	await page.getByRole('button', { name: '停止する' }).click();
	await expect(page.getByRole('alert')).toContainText('自分自身は停止できません');
	// A later success clears the message.
	const other = (
		await pool.query(`insert into member (username) values ($1) returning id`, [
			`e2e_adm_s${++n}_${tag}`
		])
	).rows[0];
	memberIds.push(other.id);
	await username.fill(`e2e_adm_s${n}_${tag}`);
	await page.getByRole('button', { name: '停止する' }).click();
	await expect(page.locator('section[aria-labelledby=suspension-heading]')).toContainText(
		`e2e_adm_s${n}_${tag}`
	);
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an alcoholic Ingredient is registered, and editing its ABV recalculates the Recipes using it (FR-013/015/076)', async ({
	page,
	browser,
	baseURL
}) => {
	const name = `E2E管理リキュール${tag}`;
	ingredientNames.push(name);
	await page.goto('/admin');
	await page.getByLabel('名前', { exact: true }).fill(name);
	await page.getByLabel('度数(%)', { exact: true }).fill('20');
	await page.getByLabel('ベース', { exact: true }).check();
	await page.getByRole('button', { name: '登録' }).click();
	await expect(page.getByLabel(`${name}の度数(%)`)).toHaveValue('20');
	expect(
		(await pool.query(`select abv_percent, is_base_spirit from ingredient where name = $1`, [name]))
			.rows
	).toEqual([{ abv_percent: '20', is_base_spirit: true }]);

	// The same name again is refused.
	await page.getByLabel('名前', { exact: true }).fill(name);
	await page.getByLabel('度数(%)', { exact: true }).fill('20');
	await page.getByRole('button', { name: '登録' }).click();
	await expect(page.getByRole('alert')).toContainText('すでに登録されています');

	// A Recipe with it and an equal part of water: 10%. Raising the ABV to 30 makes it 15%.
	const author = await signedInContext(browser, baseURL, `e2e_adm_w${++n}_${tag}`);
	memberIds.push(author.memberId);
	const recipeId = await seedRecipe(author.context, author.memberId, {
		title: `E2E管理度数${tag}`,
		ingredients: [
			{ name, mixRatio: 1 },
			{ name: water, mixRatio: 1 }
		]
	});
	await author.context.close();
	await page.goto(`/recipes/${recipeId}`);
	await expect(page.getByText('約10.0%')).toBeVisible();

	await page.goto('/admin');
	await page.getByLabel(`${name}の度数(%)`).fill('30');
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST'),
		page.getByLabel(`${name}の度数(%)`).press('Enter')
	]);
	await page.goto(`/recipes/${recipeId}`);
	await expect(page.getByText('約15.0%')).toBeVisible();

	// A Base spirit cannot be made non-alcoholic.
	await page.goto('/admin');
	await page.getByLabel(`${name}の度数(%)`).fill('0');
	await page.getByLabel(`${name}の度数(%)`).press('Enter');
	await expect(page.getByRole('alert')).toContainText('ベース');
});

test('a Member gets 403 on /admin, and a signed-out visitor is sent to log in (FR-077)', async ({
	browser,
	baseURL
}) => {
	const member = await signedInContext(browser, baseURL, `e2e_adm_m${++n}_${tag}`);
	memberIds.push(member.memberId);
	const page = await member.context.newPage();
	expect((await page.goto('/admin'))?.status()).toBe(403);
	await member.context.close();

	const anon = await browser.newContext({ baseURL });
	const anonPage = await anon.newPage();
	await anonPage.goto('/admin');
	await expect(anonPage).toHaveURL(/\/login/);
	await anon.close();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 800 } });

	test('a long unbroken note stays inside the screen (NFR-006)', async ({
		page,
		browser,
		baseURL
	}) => {
		await seedReport(browser, baseURL, `https://example.com/${'a'.repeat(170)}`);
		await page.goto('/admin');
		await expect(page.getByText('https://example.com/')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390
		);
	});

	test('an error from a form far down the page is in view, not only at the top (NFR-006)', async ({
		page,
		browser,
		baseURL
	}) => {
		// Enough Reports to push the Ingredient form below the first screen.
		for (let i = 0; i < 3; i++) await seedReport(browser, baseURL);
		await page.goto('/admin');
		const name = page.getByLabel('名前', { exact: true });
		await name.fill(gin);
		await page.getByLabel('度数(%)', { exact: true }).fill('40');
		await name.scrollIntoViewIfNeeded();
		expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
		await page.getByRole('button', { name: '登録' }).click();
		const alert = page.getByRole('alert');
		await expect(alert).toContainText('すでに登録されています');
		// Still scrolled down, and the message sits at the top of the screen with it.
		expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
		expect((await alert.boundingBox())!.y).toBeLessThan(40);
	});
});

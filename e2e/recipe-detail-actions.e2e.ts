import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { pool, seedIngredient, seedPhotoUpload, signIn } from './signed-in';

const tag = randomUUID().slice(0, 8);
const gin = `E2E詳細ジン${tag}`;
const memberIds: string[] = [];

test.beforeAll(async () => {
	// Leftovers of a run that was killed before its afterAll (own prefix: specs run in parallel).
	await pool.query(`delete from member where username like 'e2e\\_det\\_%'`);
	await pool.query(`delete from ingredient where name like 'E2E詳細ジン%'`);
	await seedIngredient(gin, 40);
});

// The Recipes first: recipe_ingredient keeps the Ingredient in use.
test.afterAll(async () => {
	await pool.query(`delete from recipe where member_id = any($1)`, [memberIds]);
	await pool.query(`delete from member where id = any($1)`, [memberIds]);
	await pool.query(`delete from ingredient where name = $1`, [gin]);
});

/** Signs `context` in as a fresh Member (replacing any earlier session cookie). */
async function as(context: BrowserContext, who: string, admin = false) {
	const id = await signIn(context, `e2e_det_${randomUUID().slice(0, 4)}${who}`);
	memberIds.push(id);
	if (admin) await pool.query(`update member set is_administrator = true where id = $1`, [id]);
	return id;
}

/** A Recipe owned by whoever `page` is signed in as (POST /api/recipes, like the form does). */
async function createRecipe(page: Page, memberId: string, title: string) {
	const ingredientId = (await pool.query(`select id from ingredient where name = $1`, [gin]))
		.rows[0].id;
	const res = await page.request.post('/api/recipes', {
		data: {
			title,
			description: '',
			mainPhotoKey: await seedPhotoUpload(memberId),
			extraPhotoKeys: [],
			ingredients: [{ ingredientId, mixRatio: 1 }],
			steps: ['混ぜる']
		}
	});
	expect(res.status()).toBe(201);
	return (await res.json()).id as string;
}

/** Someone else's Recipe: the author's session is only used to create it, then replaced. */
async function recipeOfAnother(page: Page, context: BrowserContext, title: string) {
	const authorId = await as(context, 'author');
	const authorName: string = (
		await pool.query(`select username from member where id = $1`, [authorId])
	).rows[0].username;
	return { id: await createRecipe(page, authorId, title), authorName };
}

const likeCount = (page: Page) => page.getByLabel('いいね数');

test('Like and Save: toggle, survive a reload, and the Save shows in the Save list (FR-055/056)', async ({
	page,
	context
}) => {
	const { id } = await recipeOfAnother(page, context, `E2Eいいね${tag}`);
	const viewerId = await as(context, 'viewer');

	await page.goto(`/recipes/${id}`);
	await expect(likeCount(page)).toHaveText('0');
	await page.getByRole('button', { name: '♡ いいね' }).click();
	await expect(likeCount(page)).toHaveText('1');
	await page.reload();
	await expect(likeCount(page)).toHaveText('1');
	await expect(page.getByRole('button', { name: '♥ いいね済み' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: '♥ いいね済み' }).click();
	await expect(likeCount(page)).toHaveText('0');

	await page.getByRole('button', { name: '保存する' }).click();
	await expect(page.getByRole('button', { name: '保存済み' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: '保存済み' })).toBeVisible();

	const viewerName: string = (
		await pool.query(`select username from member where id = $1`, [viewerId])
	).rows[0].username;
	await page.goto(`/members/${viewerName}?tab=saved`);
	await expect(page.getByRole('link', { name: `E2Eいいね${tag}` })).toBeVisible();
});

test('a signed-out visitor sees the counts and a login link, not the buttons', async ({
	page,
	context
}) => {
	const { id } = await recipeOfAnother(page, context, `E2E非ログイン${tag}`);
	await context.clearCookies({ name: 'better-auth.session_token' });
	await page.goto(`/recipes/${id}`);
	await expect(likeCount(page)).toHaveText('0');
	await expect(page.getByRole('link', { name: '♡ ログインしていいね' })).toBeVisible();
	await expect(page.getByRole('button', { name: '保存する' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: '編集する' })).toHaveCount(0);
	await expect(page.getByText('削除する')).toHaveCount(0);
});

test('the author link opens the profile, where the Member can Follow (FR-057)', async ({
	page,
	context
}) => {
	const { id, authorName } = await recipeOfAnother(page, context, `E2Eフォロー${tag}`);
	await as(context, 'follower');
	await page.goto(`/recipes/${id}`);
	await page.getByRole('main').getByRole('link', { name: authorName }).click();
	await expect(page).toHaveURL(`/members/${authorName}`);
	await page.getByRole('button', { name: 'フォローする' }).click();
	await expect(page.getByRole('button', { name: 'フォロー中' })).toBeVisible();
});

test('the list card links the title to the Recipe and the author to the profile', async ({
	page,
	context
}) => {
	const title = `E2Eカード${tag}`;
	const { id, authorName } = await recipeOfAnother(page, context, title);
	await page.goto(`/?q=${encodeURIComponent(title)}`);
	await page.getByRole('main').getByRole('link', { name: authorName }).click();
	await expect(page).toHaveURL(`/members/${authorName}`);
	await page.goBack();
	await page.getByRole('link', { name: title }).click();
	await expect(page).toHaveURL(`/recipes/${id}`);
});

test('the owner has no Like button, edits through the link, and sees no Administrator wording', async ({
	page,
	context
}) => {
	const ownerId = await as(context, 'owner');
	const title = `E2E本人${tag}`;
	const id = await createRecipe(page, ownerId, title);

	await page.goto(`/recipes/${id}`);
	await expect(likeCount(page)).toHaveText('0');
	await expect(page.getByRole('button', { name: /いいね/ })).toHaveCount(0);
	await expect(page.getByRole('link', { name: /ログインしていいね/ })).toHaveCount(0);

	await page.getByRole('link', { name: '編集する' }).click();
	await expect(page).toHaveURL(`/recipes/${id}/edit`);
	await page.getByLabel('タイトル').fill(`${title}改`);
	await page.getByRole('button', { name: '変更を保存する' }).click();
	await expect(page).toHaveURL(`/recipes/${id}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${title}改`);

	await page.getByText('削除する').click();
	await expect(page.getByText('投稿者には通知されません')).toHaveCount(0);
});

test('the owner deletes after the confirmation and lands on the top; the Recipe is then 404 (FR-008)', async ({
	page,
	context
}) => {
	const ownerId = await as(context, 'del');
	const id = await createRecipe(page, ownerId, `E2E削除${tag}`);
	await page.goto(`/recipes/${id}`);
	await page.getByText('削除する').click();
	await expect(page.getByText('付いているいいねと保存も一緒に消え')).toBeVisible();
	await page.getByRole('button', { name: '削除を確定する' }).click();
	await expect(page).toHaveURL('/');
	expect((await page.request.get(`/recipes/${id}`)).status()).toBe(404);
});

test('another Member cannot delete it, even by posting the action (FR-008)', async ({
	page,
	context
}) => {
	const { id } = await recipeOfAnother(page, context, `E2E他人${tag}`);
	await as(context, 'other');
	await page.goto(`/recipes/${id}`);
	await expect(page.getByText('削除する')).toHaveCount(0);
	const res = await page.request.post(`/recipes/${id}?/delete`, {
		headers: { origin: new URL(page.url()).origin },
		form: {}
	});
	expect(res.status()).toBe(403);
	expect((await pool.query(`select 1 from recipe where id = $1`, [id])).rowCount).toBe(1);
});

test('an Administrator deletes someone else’s Recipe with no edit link (FR-074)', async ({
	page,
	context
}) => {
	const { id } = await recipeOfAnother(page, context, `E2E管理者${tag}`);
	await as(context, 'admin', true);
	await page.goto(`/recipes/${id}`);
	await expect(page.getByRole('link', { name: '編集する' })).toHaveCount(0);
	await page.getByText('削除する').click();
	await expect(page.getByText('投稿者には通知されません')).toBeVisible();
	await page.getByRole('button', { name: '削除を確定する' }).click();
	await expect(page).toHaveURL('/');
	expect((await page.request.get(`/recipes/${id}`)).status()).toBe(404);
});

test.describe('phone width (390px)', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('Like, Save and delete are reachable without sideways scrolling', async ({
		page,
		context
	}) => {
		const { id } = await recipeOfAnother(page, context, `E2Eスマホ${tag}`);
		await as(context, 'phone');
		await page.goto(`/recipes/${id}`);
		await page.getByRole('button', { name: '♡ いいね' }).click();
		await expect(likeCount(page)).toHaveText('1');
		await page.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByRole('button', { name: '保存済み' })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);

		const ownerId = await as(context, 'phoneown');
		const mine = await createRecipe(page, ownerId, `E2Eスマホ本人${tag}`);
		await page.goto(`/recipes/${mine}`);
		await expect(page.getByRole('link', { name: '編集する' })).toBeVisible();
		await page.getByText('削除する').click();
		await page.getByRole('button', { name: '削除を確定する' }).click();
		await expect(page).toHaveURL('/');
	});
});

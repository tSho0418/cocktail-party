import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { pool, seedIngredient, seedPhotoUpload, signIn } from './signed-in';

const tag = randomUUID().slice(0, 8);
const gin = `E2Eジン${tag}`;
const tonic = `E2Eトニック${tag}`;
const soda = `E2Eソーダ${tag}`;
let memberId: string;
const memberIds: string[] = [];

test.beforeAll(async () => {
	// Leftovers of a run that was killed before its afterAll.
	// (Own prefix: browse.e2e.ts runs in parallel with `e2e_` Members of its own.)
	await pool.query(`delete from member where username like 'e2e\\_form\\_%'`);
	await pool.query(
		`delete from ingredient where name like 'E2Eジン%' or name like 'E2Eトニック%' or name like 'E2Eソーダ%'`
	);
	await seedIngredient(gin, 40);
	await seedIngredient(tonic, 0);
	await seedIngredient(soda, 0);
});

test.beforeEach(async ({ context }) => {
	memberId = await signIn(context, `e2e_form_${randomUUID().slice(0, 8)}`);
	memberIds.push(memberId);
});

// The Recipes first: recipe_ingredient keeps the Ingredients in use.
test.afterAll(async () => {
	await pool.query(`delete from recipe where member_id = any($1)`, [memberIds]);
	await pool.query(`delete from member where id = any($1)`, [memberIds]);
	await pool.query(`delete from ingredient where name = any($1)`, [[gin, tonic, soda]]);
});

const photo = () =>
	sharp({ create: { width: 64, height: 64, channels: 3, background: '#c33' } })
		.png()
		.toBuffer();

/** POST /api/photos needs R2; the form gets a stored key the Member owns instead. */
async function stubUploads(page: Page) {
	await page.route('**/api/photos?kind=recipe', async (route) =>
		route.fulfill({ json: { keys: { list: await seedPhotoUpload(memberId) } } })
	);
}

async function pickPhoto(page: Page, label: string) {
	await page
		.getByLabel(label)
		.setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await photo() });
}

async function addIngredient(page: Page, name: string, ratio: string) {
	const search = page.getByLabel('材料を探す');
	await search.fill(name);
	await search.press('Enter');
	await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
	// Focus lands on the new row's ratio, not on <body> (NFR-005).
	const ratioInput = page.getByRole('textbox', { name: '割合' }).last();
	await expect(ratioInput).toBeFocused();
	await ratioInput.fill(ratio);
}

const recipesTitled = async (title: string) =>
	(await pool.query(`select id, auto_abv, abv_override from recipe where title = $1`, [title]))
		.rows;

test('publishes a Recipe once, even when the button is hit again while the page loads (FR-001)', async ({
	page
}) => {
	const title = `E2E投稿${tag}`;
	await stubUploads(page);
	await page.goto('/recipes/new');
	await page.getByLabel('タイトル').fill(title);
	await pickPhoto(page, '完成写真を選ぶ');
	// The alt text follows the title once typed (NFR-005).
	await expect(page.getByRole('img', { name: `${title} の完成写真` })).toBeVisible();

	// Full-width digits from a Japanese IME are accepted (FR-005).
	await addIngredient(page, gin, '１');
	await addIngredient(page, tonic, '３');
	await expect(page.getByTestId('abv-effective')).toContainText('10.0%');
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('氷を入れて注ぐ');

	// Hold the detail page back so the form is still on screen after the POST has succeeded.
	await page.route(/\/recipes\/[0-9a-f-]{36}\/__data\.json/, async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	const submit = page.getByRole('button', { name: '投稿する' });
	await submit.click();
	await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
	await expect(submit).toBeDisabled();
	await page.getByLabel('タイトル').press('Enter'); // Enter in the form must not resubmit either
	await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
	expect(await recipesTitled(title)).toHaveLength(1);
});

test('a failed save keeps the form, tells the Member, and the retry publishes once', async ({
	page
}) => {
	const title = `E2E失敗${tag}`;
	await stubUploads(page);
	await page.goto('/recipes/new');
	await page.getByLabel('タイトル').fill(title);
	await pickPhoto(page, '完成写真を選ぶ');
	await addIngredient(page, gin, '2');
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('注ぐ');

	let attempts = 0;
	await page.route('**/api/recipes', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		if (attempts++ === 0)
			return route.fulfill({ status: 409, json: { error: 'duplicate_ingredient' } });
		return route.continue();
	});
	const submit = page.getByRole('button', { name: '投稿する' });
	await submit.click();
	const alert = page.getByRole('alert').filter({ hasText: '同じ材料は1回だけ入れられます。' });
	await expect(alert).toBeFocused();
	await expect(submit).toBeEnabled();
	expect(await recipesTitled(title)).toHaveLength(0);

	await submit.click();
	await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
	expect(await recipesTitled(title)).toHaveLength(1);
});

test('a photo upload refused for the daily limit says why and the Member can pick again (#63)', async ({
	page
}) => {
	let attempts = 0;
	await page.route('**/api/photos?kind=recipe', async (route) =>
		attempts++ === 0
			? route.fulfill({ status: 429, json: { error: 'photo_daily_limit' } })
			: route.fulfill({ json: { keys: { list: await seedPhotoUpload(memberId) } } })
	);
	const title = `E2E写真上限${tag}`;
	await page.goto('/recipes/new');
	await page.getByLabel('タイトル').fill(title);
	const picker = page.getByLabel('完成写真を選ぶ');
	await pickPhoto(page, '完成写真を選ぶ');
	await expect(page.getByRole('alert').filter({ hasText: '上限' })).toBeVisible();
	await expect(picker).toBeEnabled(); // never stuck busy after the refusal
	await expect(page.getByRole('button', { name: '投稿する' })).toBeEnabled();

	await pickPhoto(page, '完成写真を選ぶ');
	await expect(page.getByRole('img', { name: `${title} の完成写真` })).toBeVisible();
	await expect(page.getByRole('alert').filter({ hasText: '上限' })).toHaveCount(0);
});

test('a Recipe refused for the daily limit says why, keeps the form, and the button works again (#63)', async ({
	page
}) => {
	const title = `E2E上限${tag}`;
	await stubUploads(page);
	await page.goto('/recipes/new');
	await page.getByLabel('タイトル').fill(title);
	await pickPhoto(page, '完成写真を選ぶ');
	await addIngredient(page, gin, '2');
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('注ぐ');

	let attempts = 0;
	await page.route('**/api/recipes', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		if (attempts++ === 0)
			return route.fulfill({ status: 429, json: { error: 'recipe_daily_limit' } });
		return route.continue();
	});
	const submit = page.getByRole('button', { name: '投稿する' });
	await submit.click();
	await expect(page.getByRole('alert').filter({ hasText: '上限' })).toBeFocused();
	await expect(submit).toBeEnabled();
	await expect(page.getByLabel('タイトル')).toHaveValue(title);
	expect(await recipesTitled(title)).toHaveLength(0);

	await submit.click();
	await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
	expect(await recipesTitled(title)).toHaveLength(1);
});

test('a response lost after the server saved does not publish twice when the Member resends (#46)', async ({
	page
}) => {
	const title = `E2E応答消失${tag}`;
	await stubUploads(page);
	await page.goto('/recipes/new');
	await page.getByLabel('タイトル').fill(title);
	await pickPhoto(page, '完成写真を選ぶ');
	await addIngredient(page, gin, '2');
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('注ぐ');

	// The server handles the first request, then the answer never reaches the browser.
	let attempts = 0;
	await page.route('**/api/recipes', async (route) => {
		if (route.request().method() !== 'POST' || attempts++ > 0) return route.continue();
		await route.fetch();
		await route.abort('failed');
	});
	const submit = page.getByRole('button', { name: '投稿する' });
	await submit.click();
	await expect(
		page
			.getByRole('alert')
			.filter({ hasText: '保存できませんでした。通信状況を確認してください。' })
	).toBeFocused();
	await expect(submit).toBeEnabled();
	expect(await recipesTitled(title)).toHaveLength(1); // it was saved, the Member could not know

	await submit.click();
	await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
	expect(await recipesTitled(title)).toHaveLength(1);
});

test('a resend of the same form reuses the idempotency key; an edited form gets a new one', async ({
	page
}) => {
	const title = `E2E鍵${tag}`;
	await stubUploads(page);
	await page.goto('/recipes/new');
	await page.getByLabel('タイトル').fill(title);
	await pickPhoto(page, '完成写真を選ぶ');
	await addIngredient(page, gin, '2');
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('注ぐ');

	const keys: string[] = [];
	await page.route('**/api/recipes', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		keys.push(route.request().postDataJSON().idempotencyKey);
		await route.abort('failed'); // the request never reaches the server
	});
	const submit = page.getByRole('button', { name: '投稿する' });
	await submit.click();
	await expect(submit).toBeEnabled();
	await submit.click();
	await expect.poll(() => keys.length).toBe(2);
	await expect(submit).toBeEnabled();
	await page.getByLabel('タイトル').fill(`${title}改`);
	await submit.click();
	await expect.poll(() => keys.length).toBe(3);

	expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
	expect(keys[1]).toBe(keys[0]);
	expect(keys[2]).not.toBe(keys[0]);
	expect(await recipesTitled(title)).toHaveLength(0);
});

test('an incomplete form is not sent; focus moves to the list of what to fix', async ({ page }) => {
	await page.goto('/recipes/new');
	await page.getByRole('button', { name: '投稿する' }).click();
	const summary = page.getByRole('alert').filter({ hasText: '入力内容を確認してください。' });
	await expect(summary).toBeFocused();
	for (const message of [
		'タイトルを入力してください。',
		'完成写真(メイン写真)を選んでください。',
		'材料を1つ以上追加してください。',
		'ステップ 1: 手順が空です。書くか、削除してください。'
	])
		await expect(summary).toContainText(message);
	await expect(page.getByLabel('タイトル')).toHaveAttribute('aria-invalid', 'true');
});

test('a ratio left empty on an alcoholic row shows no 0% estimate', async ({ page }) => {
	await page.goto('/recipes/new');
	await addIngredient(page, tonic, '3');
	await addIngredient(page, gin, '1');
	await expect(page.getByTestId('abv-effective')).toContainText('10.0%');
	await page.getByRole('textbox', { name: '割合' }).last().fill('');
	await expect(page.getByTestId('abv-effective')).toHaveCount(0);
	await expect(
		page.getByText('材料と割合を入れると、度数の目安を自動で計算します。')
	).toBeVisible();
});

test('editing keeps an override through ratio edits until the Member recalculates (FR-021, FR-023)', async ({
	page
}) => {
	const title = `E2E編集${tag}`;
	const mainKey = await seedPhotoUpload(memberId);
	const ingredients = (
		await pool.query(`select id, name from ingredient where name = any($1)`, [[gin, tonic]])
	).rows;
	const idOf = (name: string) => ingredients.find((r) => r.name === name).id;
	const created = await page.request.post('/api/recipes', {
		data: {
			title,
			description: '',
			mainPhotoKey: mainKey,
			extraPhotoKeys: [],
			ingredients: [
				{ ingredientId: idOf(gin), mixRatio: 1 },
				{ ingredientId: idOf(tonic), mixRatio: 3 }
			],
			steps: ['混ぜる'],
			abvOverride: 12
		}
	});
	expect(created.status()).toBe(201);
	const { id } = await created.json();

	await page.goto(`/recipes/${id}/edit`);
	await expect(page.getByTestId('abv-effective')).toContainText('12.0%');
	await expect(page.getByLabel('度数を自分で修正する(任意)')).toHaveValue('12');

	// Changing a ratio moves the auto value, not the override.
	await page.getByRole('textbox', { name: '割合' }).last().fill('１');
	await expect(page.getByTestId('abv-effective')).toContainText('12.0%');
	await expect(page.getByTestId('abv-auto')).toContainText('20.0%');

	// An override above the strongest Ingredient is refused, with the error tied to the field.
	const override = page.getByLabel('度数を自分で修正する(任意)');
	await override.fill('41');
	await expect(override).toHaveAttribute('aria-invalid', 'true');
	await expect(override).toHaveAccessibleDescription(/修正値は 0% を超え、材料の最高度数 40% 以下/);
	await page.getByRole('button', { name: '変更を保存する' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: '入力内容を確認してください。' })
	).toBeFocused();
	expect(Number((await recipesTitled(title))[0].abv_override)).toBe(12);

	await page.getByRole('button', { name: '再計算する' }).click();
	await expect(page.getByTestId('abv-effective')).toContainText('20.0%');
	await page.getByRole('button', { name: '変更を保存する' }).click();
	await expect(page).toHaveURL(`/recipes/${id}`);
	const [row] = await recipesTitled(title);
	expect(Number(row.auto_abv)).toBe(20);
	expect(row.abv_override).toBeNull();
});

test('reordering keeps focus on the moved item, also at the end of the list (NFR-005)', async ({
	page
}) => {
	await page.goto('/recipes/new');
	await addIngredient(page, gin, '1');
	await addIngredient(page, tonic, '1');
	await page.getByRole('button', { name: `${tonic} を上へ` }).click();
	await expect(page.getByRole('button', { name: `${tonic} を上へ` })).toBeDisabled();
	await expect(page.getByRole('button', { name: `${tonic} を下へ` })).toBeFocused();

	await page.getByRole('button', { name: 'ステップを追加' }).click();
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('一つ目');
	await page.getByRole('textbox', { name: 'ステップ 2' }).fill('二つ目');
	await page.getByRole('button', { name: 'ステップ 1 を下へ' }).click();
	// The first step's text travelled with it, and so did focus.
	await expect(page.getByRole('textbox', { name: 'ステップ 2' })).toHaveValue('一つ目');
	await expect(page.getByRole('button', { name: 'ステップ 2 を上へ' })).toBeFocused();
});

test('the photo picker waits for an upload to finish, so the first pick stays the main photo', async ({
	page
}) => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/api/photos?kind=recipe', async (route) => {
		const keys = { list: await seedPhotoUpload(memberId) };
		await held;
		await route.fulfill({ json: { keys } });
	});
	await page.goto('/recipes/new');
	await pickPhoto(page, '完成写真を選ぶ');
	await expect(page.getByLabel('完成写真を選ぶ')).toBeDisabled();
	await expect(page.getByLabel('写真を追加する')).toBeDisabled();
	release();
	await expect(page.getByLabel('完成写真を変更する')).toBeEnabled();
});

test('deleting an Ingredient row moves focus to the next row, else the previous, else the search (NFR-005)', async ({
	page
}) => {
	await page.goto('/recipes/new');
	await addIngredient(page, gin, '1');
	await addIngredient(page, tonic, '2');
	await addIngredient(page, soda, '3');
	const ratios = page.getByRole('textbox', { name: '割合' });
	const focused = page.locator(':focus');

	await page.getByRole('button', { name: `${tonic} を削除` }).click();
	await expect(ratios).toHaveCount(2);
	await expect(focused).toHaveValue('3'); // the next row (soda) took its place

	await page.getByRole('button', { name: `${soda} を削除` }).click();
	await expect(ratios).toHaveCount(1);
	await expect(focused).toHaveValue('1'); // the last row went: the previous one (gin)

	await page.getByRole('button', { name: `${gin} を削除` }).click();
	await expect(ratios).toHaveCount(0);
	await expect(page.getByLabel('材料を探す')).toBeFocused();
});

test('deleting a step moves focus to the next step, else the previous; the last one cannot be deleted (NFR-005)', async ({
	page
}) => {
	await page.goto('/recipes/new');
	const add = page.getByRole('button', { name: 'ステップを追加' });
	await add.click();
	await add.click();
	for (const n of [1, 2, 3])
		await page.getByRole('textbox', { name: `ステップ ${n}` }).fill(`手順${n}`);

	await page.getByRole('button', { name: 'ステップ 2 を削除' }).click();
	await expect(page.getByRole('textbox', { name: 'ステップ 2' })).toHaveValue('手順3');
	await expect(page.getByRole('textbox', { name: 'ステップ 2' })).toBeFocused();

	await page.getByRole('button', { name: 'ステップ 2 を削除' }).click();
	await expect(page.getByRole('textbox', { name: 'ステップ 1' })).toBeFocused();
	await expect(page.getByRole('textbox', { name: /ステップ/ })).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'ステップ 1 を削除' })).toBeDisabled();
});

test('deleting an extra photo moves focus to the next photo, else the previous, else the add control (NFR-005)', async ({
	page
}) => {
	await stubUploads(page);
	await page.goto('/recipes/new');
	await pickPhoto(page, '完成写真を選ぶ');
	await expect(page.getByLabel('完成写真を変更する')).toBeEnabled();
	for (const n of [1, 2, 3]) {
		await expect(page.getByLabel('写真を追加する')).toBeEnabled();
		await pickPhoto(page, '写真を追加する');
		await expect(page.getByRole('button', { name: `追加の写真 ${n} を削除` })).toBeVisible();
	}

	await page.getByRole('button', { name: '追加の写真 2 を削除' }).click();
	await expect(page.getByRole('button', { name: '追加の写真 3 を削除' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '追加の写真 2 を削除' })).toBeFocused();

	await page.getByRole('button', { name: '追加の写真 2 を削除' }).click();
	await expect(page.getByRole('button', { name: '追加の写真 1 を削除' })).toBeFocused();

	await page.getByRole('button', { name: '追加の写真 1 を削除' }).click();
	await expect(page.getByLabel('写真を追加する')).toBeFocused();
});

test('deleting the last extra photo during an upload moves focus to the photos heading (NFR-005)', async ({
	page
}) => {
	let uploads = 0;
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/api/photos?kind=recipe', async (route) => {
		const keys = { list: await seedPhotoUpload(memberId) };
		if (++uploads === 3) await held; // main and the first extra finish; the second extra hangs
		await route.fulfill({ json: { keys } });
	});
	await page.goto('/recipes/new');
	await pickPhoto(page, '完成写真を選ぶ');
	await expect(page.getByLabel('完成写真を変更する')).toBeEnabled();
	await pickPhoto(page, '写真を追加する');
	await expect(page.getByRole('button', { name: '追加の写真 1 を削除' })).toBeVisible();
	await expect(page.getByLabel('写真を追加する')).toBeEnabled();
	await pickPhoto(page, '写真を追加する');
	await expect(page.getByLabel('写真を追加する')).toBeDisabled();

	await page.getByRole('button', { name: '追加の写真 1 を削除' }).click();
	await expect(page.getByRole('button', { name: '追加の写真 1 を削除' })).toHaveCount(0);
	await expect(page.getByText('追加の写真(任意')).toBeFocused();
	release();
});

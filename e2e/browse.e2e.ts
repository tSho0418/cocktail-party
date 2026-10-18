import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';

// Needs the app's database (CI starts one; locally the compose Postgres from the README).
const pool = new pg.Pool({
	connectionString:
		process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cocktail_party'
});
const tag = randomUUID().slice(0, 8);
const title = `E2Eジン${tag}`;
const recipeId = randomUUID();
const photoPrefix = `recipe/${randomUUID()}`;
let memberId: string;

test.beforeAll(async () => {
	memberId = (
		await pool.query(`insert into member (username) values ($1) returning id`, [`e2e_${tag}`])
	).rows[0].id;
	const ingredientId = (
		await pool.query(
			`insert into ingredient (name, abv_percent, is_base_spirit) values ($1, 40, true) returning id`,
			[`E2E材料${tag}`]
		)
	).rows[0].id;
	await pool.query(
		`insert into recipe (id, member_id, title, description, main_photo_key, auto_abv, has_alcohol, search_text)
		 values ($1, $2, $3, '説明文', $4, 40, true, $5)`,
		[
			recipeId,
			memberId,
			title,
			`${photoPrefix}/list.webp`,
			`${title} 説明文 E2E材料${tag} 氷に注ぐ`
		]
	);
	await pool.query(`insert into recipe_ingredient values ($1, $2, 3, 1)`, [recipeId, ingredientId]);
	await pool.query(`insert into recipe_step values ($1, 1, '氷に注ぐ')`, [recipeId]);
});

test.afterAll(async () => {
	// Deleting the Member cascades its Recipe; the Ingredient is then unreferenced.
	await pool.query(`delete from member where id = $1`, [memberId]);
	await pool.query(`delete from ingredient where name = $1`, [`E2E材料${tag}`]);
	await pool.end();
});

test('search the list, open the Recipe, and read it with OGP', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('searchbox', { name: 'キーワード' }).fill(`E2E材料${tag}`);
	await page.getByRole('button', { name: '検索' }).click();
	const card = page.getByRole('link', { name: new RegExp(title) });
	await expect(card).toBeVisible();
	await expect(card.getByRole('img')).toHaveAttribute('alt', `${title}の写真`);

	await card.click();
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(page.getByText(`E2E材料${tag}`, { exact: true })).toBeVisible();
	await expect(page.getByText('氷に注ぐ')).toBeVisible();
	await expect(page.getByAltText(`${title}の写真`)).toBeVisible();
	await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		'content',
		new RegExp(`${photoPrefix}/detail\\.webp$`)
	);
});

test('the Recipe body is in the server HTML (FR-062)', async ({ request }) => {
	const html = await (await request.get(`/recipes/${recipeId}`)).text();
	expect(html).toContain(title);
	expect(html).toContain('氷に注ぐ');
	expect(html).toContain('property="og:image"');
});

test('an unknown Recipe is a 404', async ({ request }) => {
	expect((await request.get(`/recipes/${randomUUID()}`)).status()).toBe(404);
});

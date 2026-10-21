import { createHmac, randomUUID } from 'node:crypto';
import type { Browser, BrowserContext } from '@playwright/test';
import pg from 'pg';

/** Signs the session cookie Better Auth reads; playwright.config.ts gives the server the same secret. */
export const E2E_AUTH_SECRET = 'e2e-only-secret-never-used-outside-playwright';

export const pool = new pg.Pool({
	connectionString:
		process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cocktail_party'
});

/**
 * A Member with a Username and a live session, signed in on `context`: stands in for the Google/LINE
 * login (ADR 0005), which needs real credentials. The session row is what the server trusts.
 */
export async function signIn(context: BrowserContext, username: string) {
	const memberId: string = (
		await pool.query(`insert into member (username) values ($1) returning id`, [username])
	).rows[0].id;
	const token = randomUUID().replaceAll('-', '');
	await pool.query(
		`insert into session (token, user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
		[token, memberId]
	);
	const signature = createHmac('sha256', E2E_AUTH_SECRET).update(token).digest('base64');
	await context.addCookies([
		{
			name: 'better-auth.session_token',
			value: encodeURIComponent(`${token}.${signature}`),
			domain: 'localhost',
			path: '/'
		}
	]);
	return memberId;
}

/** What POST /api/photos would have stored for `memberId`: an upload record, and the key the form submits. */
export async function seedPhotoUpload(memberId: string) {
	const id = randomUUID();
	await pool.query(`insert into photo_upload (id, member_id, kind) values ($1, $2, 'recipe')`, [
		id,
		memberId
	]);
	return `recipe/${id}/list.webp`;
}

export async function seedIngredient(name: string, abvPercent: number) {
	await pool.query(
		`insert into ingredient (name, abv_percent, is_base_spirit) values ($1, $2, $3)`,
		[name, abvPercent, abvPercent > 0]
	);
}

/** A Member signed in on a context of their own, for acting as someone other than the test's `context`. */
export async function signedInContext(
	browser: Browser,
	baseURL: string | undefined,
	username: string
) {
	const context = await browser.newContext({ baseURL });
	return { context, memberId: await signIn(context, username) };
}

/**
 * Publishes a Recipe as the Member signed in on `context`, through the real POST /api/recipes
 * (derived columns and search text included). `ingredients` are named Ingredients already seeded.
 */
export async function seedRecipe(
	context: BrowserContext,
	memberId: string,
	input: { title: string; ingredients: { name: string; mixRatio: number }[]; abvOverride?: number }
) {
	const names = input.ingredients.map((i) => i.name);
	const rows: { id: string; name: string }[] = (
		await pool.query(`select id, name from ingredient where name = any($1)`, [names])
	).rows;
	const response = await context.request.post('/api/recipes', {
		data: {
			title: input.title,
			mainPhotoKey: await seedPhotoUpload(memberId),
			ingredients: input.ingredients.map((i) => ({
				ingredientId: rows.find((r) => r.name === i.name)!.id,
				mixRatio: i.mixRatio
			})),
			steps: ['混ぜる'],
			abvOverride: input.abvOverride
		}
	});
	if (response.status() !== 201)
		throw new Error(`seedRecipe: ${response.status()} ${await response.text()}`);
	return (await response.json()).id as string;
}

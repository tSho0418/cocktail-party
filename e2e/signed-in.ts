import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
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

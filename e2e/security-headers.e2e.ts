import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { pool, seedIngredient, seedPhotoUpload, seedRecipe, signIn } from './signed-in';

// #66: the CSP is enforced (not report-only), so these specs open the real pages in Chromium and
// fail on any violation or console error. R2_PUBLIC_BASE_URL is img.example.invalid (playwright.config.ts).
// The sign-in specs follow a redirect to Google/LINE; those hosts are made unreachable on purpose, so the
// specs only need the browser to try (and never depend on the network).
test.use({
	launchOptions: {
		args: ['--host-resolver-rules=MAP accounts.google.com ~NOTFOUND, MAP access.line.me ~NOTFOUND']
	}
});

const tag = randomUUID().slice(0, 8);
const gin = `E2E防御ジン${tag}`;
const tonic = `E2E防御トニック${tag}`;
const memberIds: string[] = [];

test.beforeAll(async () => {
	// Leftovers of a run that was killed before its afterAll (own prefix: specs run in parallel).
	await pool.query(`delete from member where username like 'e2e\\_sec\\_%'`);
	await pool.query(`delete from ingredient where name like 'E2E防御%'`);
	await seedIngredient(gin, 40);
	await seedIngredient(tonic, 0);
});

// The Recipes first: recipe_ingredient keeps the Ingredients in use.
test.afterAll(async () => {
	await pool.query(`delete from recipe where member_id = any($1)`, [memberIds]);
	await pool.query(`delete from member where id = any($1)`, [memberIds]);
	await pool.query(`delete from ingredient where name = any($1)`, [[gin, tonic]]);
});

type Watched = { problems: () => Promise<string[]> };

/** Collects CSP violations and console errors of everything the page does from now on. */
async function watch(page: Page): Promise<Watched> {
	const problems: string[] = [];
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) =>
			console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`)
		);
	});
	page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
	page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
	// R2 is never reached from the specs: serve the Photo host here, which also proves img-src lets it through.
	await page.route('https://img.example.invalid/**', async (route) =>
		route.fulfill({ contentType: 'image/png', body: await redSquare() })
	);
	return { problems: async () => problems };
}

const redSquare = () =>
	sharp({ create: { width: 64, height: 64, channels: 3, background: '#c33' } })
		.png()
		.toBuffer();

async function openClean(page: Page, path: string) {
	const watched = await watch(page);
	const response = await page.goto(path);
	await page.waitForLoadState('networkidle');
	expect(response!.status(), path).toBe(200);
	expect(await watched.problems(), path).toEqual([]);
}

test('every answer carries the security headers, page or not (#66)', async ({ request }) => {
	for (const path of ['/', '/login', '/terms', '/api/health', '/api/me', '/no-such-page']) {
		const res = await request.get(path);
		const headers = res.headers();
		expect(headers['x-content-type-options'], path).toBe('nosniff');
		expect(headers['x-frame-options'], path).toBe('DENY');
		expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
		expect(headers['permissions-policy'], path).toContain('camera=()');
		expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
	}
	const page = (await request.get('/')).headers()['content-security-policy'];
	expect(page).toMatch(/script-src 'self' 'nonce-[^']+'/);
	expect(page).not.toMatch(/script-src[^;]*unsafe-inline/);
	expect(page).toMatch(/img-src [^;]*https:\/\/img\.example\.invalid/);
});

test('public pages open without a CSP violation or console error', async ({ page, context }) => {
	const author = await signIn(context, `e2e_sec_${randomUUID().slice(0, 8)}`);
	memberIds.push(author);
	const id = await seedRecipe(context, author, {
		title: `E2E防御レシピ${tag}`,
		ingredients: [
			{ name: gin, mixRatio: 2 },
			{ name: tonic, mixRatio: 3 }
		]
	});
	await context.clearCookies({ name: 'better-auth.session_token' });

	for (const path of ['/', '/login', '/terms', '/privacy', `/recipes/${id}`, '/dev/photo-picker'])
		await openClean(page, path);
	// The photo of the Recipe is the R2 host's: it loaded, not just rendered.
	await page.goto(`/recipes/${id}`);
	await expect
		.poll(() =>
			page
				.locator('img')
				.evaluateAll((l) => l.every((i) => (i as HTMLImageElement).naturalWidth > 0))
		)
		.toBe(true);
});

test('the Age Gate opens without a violation', async ({ browser }) => {
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const page = await context.newPage();
	await openClean(page, '/');
	await expect(page.getByRole('dialog', { name: '年齢の確認' })).toBeVisible();
	await context.close();
});

test('a picked photo previews from a blob: URL without a violation', async ({ page }) => {
	const watched = await watch(page);
	await page.goto('/dev/photo-picker');
	await page
		.getByLabel('写真を選ぶ')
		.setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await redSquare() });
	await expect(page.getByRole('img', { name: '選んだ写真' })).toHaveAttribute('src', /^blob:/);
	await expect
		.poll(() =>
			page
				.getByRole('img', { name: '選んだ写真' })
				.evaluate((i) => (i as HTMLImageElement).naturalWidth)
		)
		.toBeGreaterThan(0);
	expect(await watched.problems()).toEqual([]);
});

test('a signed-in Member publishes a Recipe with a photo, and /admin opens, without a violation', async ({
	page,
	context
}) => {
	const memberId = await signIn(context, `e2e_sec_${randomUUID().slice(0, 8)}`);
	memberIds.push(memberId);
	const watched = await watch(page);
	// POST /api/photos needs R2; the form gets a stored key the Member owns instead.
	await page.route('**/api/photos?kind=recipe', async (route) =>
		route.fulfill({ json: { keys: { list: await seedPhotoUpload(memberId) } } })
	);

	await page.goto('/recipes/new');
	const title = `E2E防御投稿${tag}`;
	await page.getByLabel('タイトル').fill(title);
	await page
		.getByLabel('完成写真を選ぶ')
		.setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await redSquare() });
	await expect(page.getByRole('img', { name: `${title} の完成写真` })).toBeVisible();
	const search = page.getByLabel('材料を探す');
	await search.fill(gin);
	await search.press('Enter');
	await page.getByRole('button', { name: new RegExp(`^${gin}`) }).click();
	await page.getByRole('textbox', { name: '割合' }).last().fill('2');
	await page.getByRole('textbox', { name: 'ステップ 1' }).fill('注ぐ');
	await page.getByRole('button', { name: '投稿する' }).click();
	await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
	await page.waitForLoadState('networkidle');

	await pool.query(`update member set is_administrator = true where id = $1`, [memberId]);
	await page.goto('/admin');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	expect(await watched.problems()).toEqual([]);
});

// Chrome applies `form-action` to the redirects of a form POST too, so the sign-in form (a plain POST,
// answered 303 to the provider) needs the provider's host in it; without it the click ends on /login
// with a violation.
for (const [button, url] of [
	['Google でログイン', 'https://accounts.google.com/o/oauth2/v2/auth'],
	['LINE でログイン', 'https://access.line.me/oauth2/v2.1/authorize']
] as const)
	test(`${button} is not blocked on its way to the provider`, async ({ page }) => {
		const watched = await watch(page);
		await page.goto('/login');
		const provider = page.waitForRequest((r) => r.url().startsWith(url));
		await page.getByRole('button', { name: button }).click();
		await provider; // no request to the provider means the browser blocked the redirect
		expect(
			(await watched.problems()).filter(
				(p) => p.includes('Content Security Policy') || p.includes('CSP violation')
			)
		).toEqual([]);
	});

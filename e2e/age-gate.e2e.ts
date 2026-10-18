import { expect, test } from '@playwright/test';
import { AGE_GATE_COOKIE, AGE_GATE_MAX_AGE_SECONDS } from '../src/lib/age-gate';

// The other specs start with the consent cookie (playwright.config.ts); a first visit has none.
test.use({ storageState: { cookies: [], origins: [] } });

test('first visit: gate covers the page, whose HTML is still served (FR-060, FR-062)', async ({
	page,
	request
}) => {
	const html = await (await request.get('/')).text();
	expect(html).toContain('data-age-gate');
	expect(html).toContain('Cocktail Party'); // page body, present beside the gate

	await page.goto('/');
	const dialog = page.getByRole('dialog', { name: '年齢の確認' });
	await expect(dialog).toBeVisible();
	await expect(page.locator('h1')).toBeAttached();
	await expect(page.getByRole('button', { name: 'はい、20歳以上です' })).toBeFocused();
});

test('keyboard cannot reach the page behind the gate; the page does not scroll', async ({
	page
}) => {
	await page.goto('/login'); // has focusable controls of its own
	const gateButton = page.getByRole('button', { name: 'はい、20歳以上です' });
	await expect(gateButton).toBeFocused();
	for (let i = 0; i < 6; i++) {
		await page.keyboard.press('Tab');
		expect(
			await page.evaluate(() => document.activeElement?.closest('[inert]') ?? null)
		).toBeNull();
	}
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
		'hidden'
	);
});

test('declining keeps the gate with a message, and can be undone', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'いいえ' }).click();
	await expect(page.getByText('20歳未満の方はこのサイトをご利用いただけません')).toBeVisible();
	await expect(page.getByRole('button', { name: 'はい、20歳以上です' })).toHaveCount(0);
	expect((await page.context().cookies()).some((c) => c.name === AGE_GATE_COOKIE)).toBe(false);

	await page.getByRole('link', { name: '戻る' }).click();
	await expect(page.getByRole('button', { name: 'はい、20歳以上です' })).toBeVisible();
});

test('consenting sets a 30-day cookie, removes the gate and remembers it', async ({
	page,
	context
}) => {
	await page.goto('/login');
	await page.getByRole('button', { name: 'はい、20歳以上です' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.locator('[data-age-gate]')).toHaveCount(0);

	const cookie = (await context.cookies()).find((c) => c.name === AGE_GATE_COOKIE);
	expect(cookie).toBeDefined();
	const lifetime = cookie!.expires - Date.now() / 1000;
	expect(Math.abs(lifetime - AGE_GATE_MAX_AGE_SECONDS)).toBeLessThan(120);

	await page.reload();
	await expect(page.locator('[data-age-gate]')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

test('home page loads', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1')).toBeVisible();
});

test('GET /api/health', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(res.ok()).toBe(true);
	expect(await res.json()).toEqual({ ok: true });
});

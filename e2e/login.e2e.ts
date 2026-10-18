import { expect, test } from '@playwright/test';

test('login page offers exactly Google and LINE (FR-050, FR-051)', async ({ page }) => {
	await page.goto('/login');
	const buttons = page.getByRole('button');
	await expect(buttons).toHaveCount(2);
	await expect(buttons.nth(0)).toHaveText('Google でログイン');
	await expect(buttons.nth(1)).toHaveText('LINE でログイン');
	await expect(page.locator('input')).toHaveCount(0);
	await expect(page.getByText('別のアカウントになり')).toBeVisible();
});

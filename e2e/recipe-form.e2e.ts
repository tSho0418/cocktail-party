import { expect, test } from '@playwright/test';

// The signed-in form is covered by recipe-form-signed-in.e2e.ts.
test.describe('signed out', () => {
	for (const path of ['/recipes/new', '/recipes/00000000-0000-4000-8000-000000000001/edit'])
		test(`${path} sends a visitor to /login`, async ({ page }) => {
			await page.goto(path);
			await expect(page).toHaveURL('/login');
		});
});

test('Enter in the Ingredient search does not submit the Recipe form', async ({ page }) => {
	await page.goto('/dev/ingredient-picker');
	await page.getByLabel('材料を探す').fill('ジン');
	await page.getByLabel('材料を探す').press('Enter');
	await expect(page.locator('output')).toHaveAttribute('data-submits', '0');
	// Enter elsewhere in a form still submits it: the button does.
	await page.getByRole('button', { name: '送信' }).click();
	await expect(page.locator('output')).toHaveAttribute('data-submits', '1');
});

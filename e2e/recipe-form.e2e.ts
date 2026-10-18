import { expect, test } from '@playwright/test';

// The signed-in form needs a session and a database; see the PR for how it was exercised by hand.
test.describe('signed out', () => {
	for (const path of ['/recipes/new', '/recipes/00000000-0000-4000-8000-000000000001/edit'])
		test(`${path} sends a visitor to /login`, async ({ page }) => {
			await page.goto(path);
			await expect(page).toHaveURL('/login');
		});
});

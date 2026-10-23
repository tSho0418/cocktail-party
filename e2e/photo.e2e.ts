import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { processUpload } from '../src/lib/server/services/images/process';
import { bigJpeg, isRedAt, transparentPng } from '../src/lib/server/services/images/test-fixtures';

const pngFile = async () => {
	const buffer = await transparentPng({ width: 1400, height: 1400 });
	expect(buffer.length).toBeGreaterThan(4_500_000);
	return { name: 'clear.png', mimeType: 'image/png', buffer };
};

async function pickedBytes(page: Page) {
	const src = await page.getByRole('img', { name: '選んだ写真' }).getAttribute('src');
	const bytes = await page.evaluate(
		async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
		src!
	);
	return Buffer.from(bytes);
}

// The page's CSP (`connect-src 'self'`) refuses the specs' own fetch() of the preview's blob: URL, which the
// app never does; e2e/security-headers.e2e.ts covers the preview under the real CSP.
test.use({ bypassCSP: true });

// Chromium only; iOS Safari / Android Chrome behaviour is listed under "Known limits" in the README.
test.describe('PhotoPicker', () => {
	test.beforeEach(({ browserName }) => test.skip(browserName !== 'chromium'));

	test('10MB rotated JPEG -> <4.5MB blob, orientation baked in, server accepts it', async ({
		page
	}) => {
		test.setTimeout(120_000);
		// Stored 5000x3750 landscape, red top-left; Orientation 6 -> shown portrait, red top-right.
		const original = await bigJpeg({
			width: 5000,
			height: 3750,
			target: 10_000_000,
			orientation: 6
		});
		expect(original.length).toBeGreaterThan(9_000_000);

		await page.goto('/dev/photo-picker');
		await page
			.getByLabel('写真を選ぶ')
			.setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: original });

		const output = page.locator('output');
		await expect(output).toHaveAttribute('data-type', 'image/jpeg', { timeout: 30_000 });
		expect(Number(await output.getAttribute('data-size'))).toBeLessThan(4_500_000);

		const blob = await pickedBytes(page);
		const meta = await sharp(blob).metadata();
		expect(meta.orientation ?? 1).toBe(1);
		expect(meta.height).toBeGreaterThan(meta.width);
		expect(await isRedAt(blob, 0.9, 0.1)).toBe(true);

		const result = await processUpload(blob);
		expect(result.ok && [result.list.height, result.detail.height]).toEqual([480, 1600]);
	});

	test('>4.5MB transparent PNG -> JPEG with a white (not black) background', async ({ page }) => {
		await page.goto('/dev/photo-picker');
		await page.getByLabel('写真を選ぶ').setInputFiles(await pngFile());
		await expect(page.locator('output')).toHaveAttribute('data-type', 'image/jpeg', {
			timeout: 30_000
		});
		// Left half of the source is fully transparent. (stats() ignores extract(), so crop first.)
		const jpeg = await pickedBytes(page);
		const { width, height } = await sharp(jpeg).metadata();
		const left = await sharp(jpeg)
			.extract({ left: 0, top: 0, width: Math.floor(width * 0.4), height })
			.toBuffer();
		const { channels } = await sharp(left).stats();
		for (const c of channels.slice(0, 3)) expect(c.mean).toBeGreaterThan(245);
	});

	test('shows a busy status, and recovers with a message if shrinking throws', async ({ page }) => {
		await page.addInitScript(() => {
			const w = window as unknown as { release: () => void };
			const decode = window.createImageBitmap.bind(window);
			// Hold decoding until the test releases it, then fail like an iOS canvas OOM.
			window.createImageBitmap = (async (...args: Parameters<typeof decode>) => {
				await new Promise<void>((r) => (w.release = r));
				return decode(...args);
			}) as typeof createImageBitmap;
			HTMLCanvasElement.prototype.toBlob = () => {
				throw new Error('out of memory');
			};
		});
		await page.goto('/dev/photo-picker');
		const input = page.getByLabel('写真を選ぶ');
		await input.setInputFiles(await pngFile());

		await expect(page.getByRole('status')).toHaveText('縮小しています…');
		await expect(input).toBeDisabled();
		await page.evaluate(() => (window as unknown as { release: () => void }).release());

		await expect(page.getByRole('alert')).toHaveText(
			'この画像は読み込めませんでした。別の画像を選んでください。'
		);
		await expect(page.getByRole('status')).toHaveText('');
		await expect(input).toBeEnabled();
	});

	test('rejects non-image types and >10MB at selection, in Japanese', async ({ page }) => {
		await page.goto('/dev/photo-picker');
		const input = page.getByLabel('写真を選ぶ');

		await input.setInputFiles({
			name: 'a.gif',
			mimeType: 'image/gif',
			buffer: Buffer.from('GIF89a')
		});
		await expect(page.getByRole('alert')).toHaveText('JPEG、PNG、WebP の画像を選んでください。');

		await input.setInputFiles({
			name: 'huge.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.alloc(10 * 1024 * 1024 + 1)
		});
		await expect(page.getByRole('alert')).toHaveText('10MB 以下の画像を選んでください。');
		await expect(page.locator('output')).toHaveCount(0);
	});
});

test('POST /api/photos rejects a request without a session with 401', async ({ request }) => {
	const res = await request.post('/api/photos', {
		headers: { 'content-type': 'application/octet-stream' },
		data: Buffer.from([0xff, 0xd8, 0xff])
	});
	expect(res.status()).toBe(401);
});

import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { MAX_BYTES, SIZES, processUpload, type Derivative, type ProcessResult } from './process';
import { CAMERA_MAKE, LATITUDE_BYTES, isRedAt, jpegWithGps, rawLandscape } from './test-fixtures';

function accepted(r: ProcessResult) {
	if (!r.ok) throw new Error(`rejected: ${r.error}`);
	return r;
}

async function assertClean(d: Derivative) {
	const m = await sharp(d.data).metadata();
	expect(m.format).toBe('webp');
	expect(m.exif).toBeUndefined();
	expect(m.xmp).toBeUndefined();
	expect(m.iptc).toBeUndefined();
	expect(m.icc).toBeUndefined();
	expect(m.orientation).toBeUndefined();
	// Check the RIFF container directly for metadata chunks and leftover values.
	for (const needle of ['EXIF', 'XMP ', 'ICCP', CAMERA_MAKE])
		expect(d.data.includes(Buffer.from(needle))).toBe(false);
	expect(d.data.includes(LATITUDE_BYTES)).toBe(false);
}

describe('processUpload', () => {
	let rotated: Buffer;
	beforeAll(async () => {
		// Orientation 6 = shown rotated 90° CW: stored 1200x800 landscape -> shown 800x1200 portrait,
		// stored top-left red block -> shown top-right.
		rotated = await jpegWithGps({ orientation: 6 });
	});

	it('fixture really carries GPS, Make and orientation', async () => {
		const m = await sharp(rotated).metadata();
		expect(m.orientation).toBe(6);
		expect(m.exif?.includes(LATITUDE_BYTES)).toBe(true);
		expect(m.exif?.includes(Buffer.from(CAMERA_MAKE))).toBe(true);
	});

	it('strips GPS/all metadata and bakes orientation into both derivatives', async () => {
		const { list, detail } = accepted(await processUpload(rotated));
		for (const d of [list, detail]) {
			await assertClean(d);
			expect(d.height).toBeGreaterThan(d.width);
			expect(await isRedAt(d.data, 0.9, 0.1)).toBe(true);
			expect(await isRedAt(d.data, 0.1, 0.1)).toBe(false);
		}
		expect(list.height).toBe(SIZES.list);
		expect(detail.height).toBe(1200); // never upscaled: 1200 < 1600
	});

	it('downsizes large input to 480 / 1600 long edge', async () => {
		const { list, detail } = accepted(
			await processUpload(await jpegWithGps({ width: 4000, height: 3000 }))
		);
		expect([list.width, list.height]).toEqual([480, 360]);
		expect([detail.width, detail.height]).toEqual([1600, 1200]);
	});

	it('accepts PNG and WebP, stripping ICC/EXIF', async () => {
		const img = rawLandscape({ width: 600, height: 400 });
		const png = await img.clone().withMetadata({ orientation: 6 }).png().toBuffer();
		const webp = await img
			.clone()
			.keepIccProfile()
			.withExif({ IFD0: { Make: CAMERA_MAKE } })
			.webp()
			.toBuffer();
		expect((await sharp(webp).metadata()).exif).toBeDefined();
		for (const b of [png, webp]) {
			const { list, detail } = accepted(await processUpload(b));
			await assertClean(list);
			await assertClean(detail);
		}
	});

	it('rejects by content, not by name', async () => {
		const solid = () =>
			sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } });
		const cases: [Buffer, string][] = [
			[await solid().gif().toBuffer(), 'unsupported_format'],
			[await solid().tiff().toBuffer(), 'unsupported_format'],
			[
				Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
				'unsupported_format'
			],
			[Buffer.from('hello'), 'unsupported_format'],
			// PHP with JPEG magic bytes: sniff says jpeg, the decoder disagrees.
			[
				Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<?php echo 1; ?>')]),
				'undecodable'
			]
		];
		for (const [b, error] of cases) expect(await processUpload(b)).toEqual({ ok: false, error });
	});

	it('rejects > 4.5MB and pixel bombs', async () => {
		expect(await processUpload(Buffer.alloc(MAX_BYTES + 1, 0xff))).toEqual({
			ok: false,
			error: 'too_large'
		});
		// 10000x10000 solid PNG is tiny on disk but 100MP decoded.
		const bomb = await sharp({
			create: { width: 10000, height: 10000, channels: 3, background: 'red' }
		})
			.png()
			.toBuffer();
		expect(bomb.length).toBeLessThan(MAX_BYTES);
		expect(await processUpload(bomb)).toEqual({ ok: false, error: 'too_many_pixels' });
	});
});

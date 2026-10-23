// ADR 0003 server side: sniff, re-encode, strip metadata, emit two WebP derivatives.
import sharp from 'sharp';

export const MAX_BYTES = 4_500_000; // Vercel function body limit (4.5MB), taken as decimal to be conservative
export const MAX_PIXELS = 30_000_000; // decompression-bomb guard: a 4.5MB PNG can declare a huge canvas
export const SIZES = { list: 480, detail: 1600 } as const;

type Format = 'jpeg' | 'png' | 'webp';

export type Derivative = { data: Buffer; width: number; height: number };

export type ProcessError =
	'too_large' | 'unsupported_format' | 'format_mismatch' | 'too_many_pixels' | 'undecodable';

export type ProcessResult =
	{ ok: true; list: Derivative; detail: Derivative } | { ok: false; error: ProcessError };

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Format from magic bytes only; extension and client Content-Type are never trusted. */
export function sniff(buf: Buffer): Format | null {
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
	if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
	if (
		buf.length >= 12 &&
		buf.toString('latin1', 0, 4) === 'RIFF' &&
		buf.toString('latin1', 8, 12) === 'WEBP'
	)
		return 'webp';
	return null;
}

export async function processUpload(bytes: Uint8Array): Promise<ProcessResult> {
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (buf.length > MAX_BYTES) return { ok: false, error: 'too_large' };
	const format = sniff(buf);
	if (!format) return { ok: false, error: 'unsupported_format' };

	try {
		// Header only: reports the declared size without decoding pixels.
		const meta = await sharp(buf).metadata();
		// Defensive: libvips also sniffs magic bytes, so in practice a mismatch throws (undecodable)
		// before this can fire. Kept as a cheap guard in case the decoder ever trusts something else.
		if (meta.format !== format) return { ok: false, error: 'format_mismatch' };
		if (meta.width * meta.height > MAX_PIXELS) return { ok: false, error: 'too_many_pixels' };
		const base = sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' });

		// rotate() with no args bakes EXIF Orientation into pixels. Without withMetadata()/keep*(),
		// sharp writes no EXIF/XMP/IPTC/ICC (pixels are converted to sRGB first).
		const oriented = base.rotate();
		const derive = async (edge: number): Promise<Derivative> => {
			const { data, info } = await oriented
				.clone()
				.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
				.webp({ quality: 80 })
				.toBuffer({ resolveWithObject: true });
			return { data, width: info.width, height: info.height };
		};
		// One after the other: each clone() decodes the input again, and two decodes at once double
		// the peak memory (a decoded 30MP image is ~90-120MB) on a small serverless instance.
		const list = await derive(SIZES.list);
		const detail = await derive(SIZES.detail);
		return { ok: true, list, detail };
	} catch {
		return { ok: false, error: 'undecodable' };
	}
}

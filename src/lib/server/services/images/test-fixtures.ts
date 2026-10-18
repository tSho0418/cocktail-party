// Test-only image generators (vitest and Playwright). Never imported by app code.
import sharp from 'sharp';

export const CAMERA_MAKE = 'SpikeCam';
// 35°39'29.10"N as the three EXIF RATIONALs (num, den) little-endian.
const LATITUDE: [number, number][] = [
	[35, 1],
	[39, 1],
	[2910, 100]
];
export const LATITUDE_BYTES = Buffer.from(new Uint32Array(LATITUDE.flat()).buffer);

/** Stored (raw) pixels are landscape with a red block at top-left; the rest is blue. */
export function rawLandscape({ width, height, noise = false }: Size & { noise?: boolean }) {
	const px = Buffer.alloc(width * height * 3);
	for (let i = 0; i < width * height; i++) {
		const x = i % width;
		const y = (i / width) | 0;
		const red = x < width / 4 && y < height / 4;
		const n = noise ? (Math.random() * 60) | 0 : 0;
		px[i * 3] = red ? 255 - n : n;
		px[i * 3 + 1] = n;
		px[i * 3 + 2] = red ? n : 255 - n;
	}
	return sharp(px, { raw: { width, height, channels: 3 } });
}

type Size = { width: number; height: number };

// Minimal little-endian TIFF/EXIF: IFD0 {Make, Orientation, GPS pointer} -> GPS IFD {LatitudeRef, Latitude}.
// Hand-built because sharp's withExif() cannot write the GPS IFD.
function exifSegment(orientation: number) {
	const t = Buffer.alloc(114);
	t.write('II', 0, 'latin1');
	t.writeUInt16LE(42, 2);
	t.writeUInt32LE(8, 4);
	const entry = (at: number, tag: number, type: number, count: number, value: number) => {
		t.writeUInt16LE(tag, at);
		t.writeUInt16LE(type, at + 2);
		t.writeUInt32LE(count, at + 4);
		t.writeUInt32LE(value, at + 8);
	};
	t.writeUInt16LE(3, 8);
	entry(10, 0x010f, 2, CAMERA_MAKE.length + 1, 50); // Make -> "SpikeCam\0" at 50
	entry(22, 0x0112, 3, 1, orientation); // Orientation (SHORT, inline)
	entry(34, 0x8825, 4, 1, 60); // GPS IFD at 60
	t.write(CAMERA_MAKE, 50, 'latin1');
	t.writeUInt16LE(2, 60);
	entry(62, 0x0001, 2, 2, 0);
	t.write('N', 70, 'latin1'); // GPSLatitudeRef inline
	entry(74, 0x0002, 5, 3, 90); // GPSLatitude -> 3 RATIONALs at 90
	LATITUDE_BYTES.copy(t, 90);
	const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
	const header = Buffer.from([0xff, 0xe1, 0, 0]);
	header.writeUInt16BE(payload.length + 2, 2);
	return Buffer.concat([header, payload]);
}

/** JPEG with GPS + camera EXIF and the given Orientation tag. */
export async function jpegWithGps({
	width = 1200,
	height = 800,
	orientation = 1,
	noise = false,
	quality = 90
} = {}) {
	const jpeg = await rawLandscape({ width, height, noise }).jpeg({ quality }).toBuffer();
	// APP1 right after SOI.
	return Buffer.concat([jpeg.subarray(0, 2), exifSegment(orientation), jpeg.subarray(2)]);
}

/** Noisy JPEG close to (but not over) `target` bytes, stepping quality down. */
export async function bigJpeg({
	width,
	height,
	target,
	orientation = 1
}: Size & {
	target: number;
	orientation?: number;
}) {
	for (let quality = 100; quality >= 50; quality -= 2) {
		const buf = await jpegWithGps({ width, height, orientation, noise: true, quality });
		if (buf.length <= target) return buf;
	}
	throw new Error('could not hit target size');
}

/** Is the pixel near (fx, fy) (fractions of width/height) red? */
export async function isRedAt(buf: Buffer, fx: number, fy: number) {
	const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
	const i =
		(Math.floor(info.height * fy) * info.width + Math.floor(info.width * fx)) * info.channels;
	return data[i] > 200 && data[i + 2] < 60;
}

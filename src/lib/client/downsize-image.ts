// ADR 0003 browser side: shrink a selected photo (<=10MB) to under the 4.5MB server limit.
export const MAX_SELECT_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4_500_000; // must match the server's MAX_BYTES
export const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_EDGE = 4096; // also keeps the canvas under iOS Safari's ~16.7MP canvas cap

export type DownsizeError = 'unsupported_format' | 'too_large' | 'undecodable' | 'cannot_shrink';

export type DownsizeResult = { ok: true; blob: Blob } | { ok: false; error: DownsizeError };

export async function downsizeImage(file: File): Promise<DownsizeResult> {
	if (!ACCEPT.includes(file.type)) return { ok: false, error: 'unsupported_format' };
	if (file.size > MAX_SELECT_BYTES) return { ok: false, error: 'too_large' };
	if (file.size < MAX_UPLOAD_BYTES) return { ok: true, blob: file }; // the server strips EXIF anyway

	let bitmap: ImageBitmap;
	try {
		// 'from-image' applies EXIF Orientation while decoding; the canvas output then carries no EXIF.
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return { ok: false, error: 'undecodable' };
	}
	let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	try {
		for (let i = 0; i < 6; i++, scale *= 0.8) {
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			// JPEG: the only lossy type every browser's toBlob encodes (older Safari can't make WebP).
			const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
			canvas.width = canvas.height = 0; // release canvas memory early (matters on iOS)
			if (blob && blob.size < MAX_UPLOAD_BYTES) return { ok: true, blob };
		}
	} finally {
		bitmap.close();
	}
	return { ok: false, error: 'cannot_shrink' };
}

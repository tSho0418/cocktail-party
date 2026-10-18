import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ImageStore } from './store';

export type R2Config = {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	publicBaseUrl: string;
};

/** Reads R2_* from the environment; throws naming every missing variable. */
export function r2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2Config {
	const names = {
		accountId: 'R2_ACCOUNT_ID',
		accessKeyId: 'R2_ACCESS_KEY_ID',
		secretAccessKey: 'R2_SECRET_ACCESS_KEY',
		bucket: 'R2_BUCKET',
		publicBaseUrl: 'R2_PUBLIC_BASE_URL'
	} as const;
	const missing = Object.values(names).filter((n) => !env[n]);
	if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
	return Object.fromEntries(
		Object.entries(names).map(([k, n]) => [k, env[n] as string])
	) as R2Config;
}

export const r2Client = (config: R2Config) =>
	new S3Client({
		region: 'auto',
		endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
	});

/** Cloudflare R2 through its S3-compatible API. */
export function r2ImageStore(config: R2Config, s3 = r2Client(config)): ImageStore {
	const base = config.publicBaseUrl.replace(/\/+$/, '');
	return {
		async put(key, data, contentType) {
			await s3.send(
				new PutObjectCommand({
					Bucket: config.bucket,
					Key: key,
					Body: data,
					ContentType: contentType,
					// Keys are random and never rewritten.
					CacheControl: 'public, max-age=31536000, immutable'
				})
			);
		},
		async delete(key) {
			await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
		},
		publicUrl: (key) => `${base}/${key}`
	};
}

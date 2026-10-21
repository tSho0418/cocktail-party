import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ImageStore } from './store';

export type R2Config = {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	publicBaseUrl: string;
};

/**
 * Reads R2_* from `env` (the app passes `$app/env/private`, scripts `process.env`; declared in
 * src/env.ts); throws naming every missing variable. This file stays free of `$app` imports so
 * scripts can load it.
 */
export function r2ConfigFromEnv(env: Record<string, string | undefined>): R2Config {
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
					// Short TTL, not immutable: a deleted Photo (FR-058, FR-074) must drop out of edge and
					// browser caches within about an hour.
					CacheControl: 'public, max-age=3600'
				})
			);
		},
		async delete(key) {
			await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
		},
		publicUrl: (key) => `${base}/${key}`
	};
}

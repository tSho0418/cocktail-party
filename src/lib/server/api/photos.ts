import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as privateEnv from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { pruneQuotaUse, reserveQuota } from '#lib/server/services/quota/index.js';
import { recordPhotoUpload } from '#lib/server/services/recipes/index.js';
import type { ApiEnv } from './http';
import {
	MAX_BYTES,
	r2ConfigFromEnv,
	r2ImageStore,
	storePhoto,
	type ImageStore,
	type OwnerKind
} from '#lib/server/services/images/index.js';

/** Default for a standalone photosRoute(): the route can never be open by accident. app.ts passes the real guard. */
export const denyAll: MiddlewareHandler = async (c) => c.json({ error: 'unauthorized' }, 401);

let r2: ImageStore | undefined;
// Built on first use so build, tests and the e2e run need no R2 credentials.
export const defaultStore = () =>
	(r2 ??= r2ImageStore(r2ConfigFromEnv(privateEnv as Record<string, string | undefined>)));

const OWNER_KINDS: OwnerKind[] = ['recipe', 'member'];

type RecordUpload = (memberId: string, kind: OwnerKind, id: string) => Promise<void>;
const recordInDb: RecordUpload = (memberId, kind, id) => recordPhotoUpload(db, memberId, kind, id);

/** Takes one of the Member's daily uploads; false when they are at the limit (services/quota). */
type Reserve = (memberId: string) => Promise<boolean>;
const reserveInDb: Reserve = async (memberId) => {
	if (!(await reserveQuota(db, memberId, 'photo'))) return false;
	// Housekeeping only: a failure must not undo an upload that is about to be accepted.
	await pruneQuotaUse(db, memberId).catch((e) =>
		console.error('quota_use prune failed', e instanceof Error ? e.name : typeof e)
	);
	return true;
};

/**
 * POST /photos?kind=recipe|member with the raw image as application/octet-stream
 * (multipart overhead would push a 4.5MB photo over the platform body limit).
 * The Content-Type must be exactly `application/octet-stream` (no parameters); our own client sets it.
 * `authorize` must let only a signed-in Member through: the upload is recorded against that
 * Member (`record`), and a Recipe can only use photos its own Member uploaded.
 * Each request takes one of the Member's daily uploads (`reserve`, services/quota) before the body
 * is read: over the limit it is 429 `photo_daily_limit` and costs no decoding and no R2 write. The
 * use stays taken when the upload then fails (413, 415, 422...): a refused photo already cost
 * CPU, so picking again counts.
 */
export const photosRoute = ({
	authorize = denyAll,
	store = defaultStore,
	record = recordInDb,
	reserve = reserveInDb
}: {
	authorize?: MiddlewareHandler;
	store?: () => ImageStore;
	record?: RecordUpload;
	reserve?: Reserve;
} = {}) =>
	new Hono<ApiEnv>().post(
		'/',
		authorize,
		// Before bodyLimit, which would read a length-less body to count it.
		async (c, next) => {
			if (!(await reserve(c.env.locals.member!.id)))
				return c.json({ error: 'photo_daily_limit' }, 429);
			await next();
		},
		// Rejects on Content-Length before reading, and counts streamed bytes when it is absent.
		bodyLimit({ maxSize: MAX_BYTES, onError: (c) => c.json({ error: 'too_large' }, 413) }),
		async (c) => {
			if (c.req.header('content-type') !== 'application/octet-stream')
				return c.json({ error: 'unsupported_media_type' }, 415);
			const kind = (c.req.query('kind') ?? 'recipe') as OwnerKind;
			if (!OWNER_KINDS.includes(kind)) return c.json({ error: 'invalid_kind' }, 400);

			const memberId = c.env.locals.member!.id;
			const s = store();
			const result = await storePhoto(s, new Uint8Array(await c.req.arrayBuffer()), kind);
			if (!result.ok) return c.json({ error: result.error }, 422);
			try {
				await record(memberId, kind, result.id);
			} catch (e) {
				// An unrecorded photo could never be attached; don't leave its objects behind.
				await Promise.allSettled([s.delete(result.keys.list), s.delete(result.keys.detail)]);
				throw e;
			}
			return c.json({ keys: result.keys }, 201);
		}
	);

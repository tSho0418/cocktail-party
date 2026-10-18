import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
	MAX_BYTES,
	r2ConfigFromEnv,
	r2ImageStore,
	storePhoto,
	type ImageStore,
	type OwnerKind
} from '#lib/server/services/images/index.js';

/** Default until auth exists: the route can never be open by accident. */
export const denyAll: MiddlewareHandler = async (c) => c.json({ error: 'unauthorized' }, 401);

let r2: ImageStore | undefined;
// Built on first use so build, tests and the e2e run need no R2 credentials.
const defaultStore = () => (r2 ??= r2ImageStore(r2ConfigFromEnv()));

const OWNER_KINDS: OwnerKind[] = ['recipe', 'member'];

/**
 * POST /photos?kind=recipe|member with the raw image as application/octet-stream
 * (multipart overhead would push a 4.5MB photo over the platform body limit).
 * The Content-Type must be exactly `application/octet-stream` (no parameters); our own client sets it.
 * `authorize` must let only a signed-in Member through.
 */
export const photosRoute = ({
	authorize = denyAll,
	store = defaultStore
}: { authorize?: MiddlewareHandler; store?: () => ImageStore } = {}) =>
	new Hono().post(
		'/',
		authorize,
		// Rejects on Content-Length before reading, and counts streamed bytes when it is absent.
		bodyLimit({ maxSize: MAX_BYTES, onError: (c) => c.json({ error: 'too_large' }, 413) }),
		async (c) => {
			if (c.req.header('content-type') !== 'application/octet-stream')
				return c.json({ error: 'unsupported_media_type' }, 415);
			const kind = (c.req.query('kind') ?? 'recipe') as OwnerKind;
			if (!OWNER_KINDS.includes(kind)) return c.json({ error: 'invalid_kind' }, 400);

			const result = await storePhoto(store(), new Uint8Array(await c.req.arrayBuffer()), kind);
			if (!result.ok) return c.json({ error: result.error }, 422);
			return c.json({ keys: result.keys }, 201);
		}
	);

// Shared by the *.db.test.ts files in this directory; never imported by app code.
import { db } from '#lib/server/db/index.js';
import { member } from '#lib/server/db/schema.js';
import { memoryImageStore } from '#lib/server/services/images/index.js';
import { jpegWithGps } from '#lib/server/services/images/test-fixtures.js';
import { createApp } from './app';

export const store = memoryImageStore();
const defaultApp = createApp({ store: () => store });

export type TestMember = NonNullable<App.Locals['member']>;

export async function seedMember(
	username: string | null,
	opts: { isAdministrator?: boolean } = {}
): Promise<TestMember> {
	const [m] = await db
		.insert(member)
		.values({ username, isAdministrator: opts.isAdministrator ?? false })
		.returning();
	return { id: m.id, username: m.username, isAdministrator: m.isAdministrator };
}

/** One request against the real app as `as` (null = signed out or suspended, see resolveMember). */
export function call(
	as: TestMember | null,
	method: string,
	path: string,
	body?: unknown,
	app: ReturnType<typeof createApp> = defaultApp
): Promise<Response> {
	return Promise.resolve(
		app.request(
			`/api${path}`,
			{
				method,
				headers: body === undefined ? {} : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			},
			{ locals: { member: as } }
		)
	);
}

/** POST /api/photos as `as` through the real route (records the upload); returns the stored keys. */
export async function uploadPhoto(
	as: TestMember,
	kind: 'recipe' | 'member' = 'recipe'
): Promise<{ list: string; detail: string }> {
	const res = await defaultApp.request(
		`/api/photos?kind=${kind}`,
		{
			method: 'POST',
			body: new Uint8Array(await jpegWithGps()),
			headers: { 'content-type': 'application/octet-stream' }
		},
		{ locals: { member: as } }
	);
	if (res.status !== 201) throw new Error(`photo upload failed: ${res.status}`);
	return (await res.json()).keys;
}

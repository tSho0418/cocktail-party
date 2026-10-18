// Shared by the *.db.test.ts files in this directory; never imported by app code.
import { db } from '#lib/server/db/index.js';
import { member } from '#lib/server/db/schema.js';
import { memoryImageStore } from '#lib/server/services/images/index.js';
import { createApp } from './app';

export const store = memoryImageStore();
const app = createApp({ store: () => store });

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
	body?: unknown
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

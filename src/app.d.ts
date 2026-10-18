// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// Filled by the auth handle (see src/hooks.server.ts); also passed to Hono as c.env.locals.
		interface Locals {
			/** Null when signed out or suspended (FR-075). */
			member: import('#lib/server/auth/index.js').Member | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

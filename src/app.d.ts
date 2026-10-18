// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// Filled by the auth handle (see src/hooks.server.ts); also passed to Hono as c.env.locals.
		// eslint-disable-next-line @typescript-eslint/no-empty-object-type
		interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

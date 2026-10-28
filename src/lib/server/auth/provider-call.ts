/**
 * Withdrawal talks to the login provider twice, both bounded by this: reading the stored token
 * (which may refresh it at the provider) before the delete, and the deauthorization or revocation
 * after it. With the database work and the object deletions, `/withdraw` runs far below its
 * `maxDuration` of 30 s (+page.server.ts).
 */
export const PROVIDER_CALL_TIMEOUT_MS = 5000;

/**
 * A failed call to a login provider. Its message is safe to log: only fixed text, the HTTP status
 * and the provider's request id, never the request (which holds the Member's token and our secret).
 */
export class ProviderCallError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProviderCallError';
	}
}

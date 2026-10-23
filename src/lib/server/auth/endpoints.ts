import { PROVIDERS } from './index';

const CALLBACK = new RegExp(`^/api/auth/callback/(${PROVIDERS.join('|')})$`);

/**
 * The only Better Auth endpoints a browser may reach through `/api/auth/*`: the providers'
 * redirect back. Starting a login goes through the `/login` actions, and sessions are read
 * in-process. Better Auth rate-limits (a database write) before it looks up the route, so
 * every other path must be refused before it gets there, or each distinct URL costs a row.
 */
export const isAuthEndpoint = (method: string, pathname: string) =>
	method === 'GET' && CALLBACK.test(pathname);

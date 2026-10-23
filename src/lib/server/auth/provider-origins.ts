/**
 * The hosts a sign-in form POST is redirected (303) to. One list for both users: SvelteKit's
 * `redirect(…, { external })` in the login action must allow them, and the page CSP's `form-action`
 * must too (Chrome applies `form-action` to the redirect of a form POST). Change it in one place.
 */
export const PROVIDER_ORIGINS = ['https://accounts.google.com', 'https://access.line.me'] as const;

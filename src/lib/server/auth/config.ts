/**
 * The public origin Better Auth uses for OAuth callbacks and its trusted origin. Without it, Better
 * Auth derives both from each request's Host, so a preview or alias URL silently becomes the callback
 * and the sign-in fails with a provider-side redirect_uri error (#66). Refused on Vercel (production
 * and Preview); locally and in tests it may stay unset. Checked when `auth()` is first built, not at
 * import, so `pnpm build` (no variables) still works.
 */
export function requireBaseUrlOnVercel(
	baseUrl: string | undefined,
	onVercel = !!process.env.VERCEL
): string | undefined {
	if (!baseUrl && onVercel)
		throw new Error(
			'BETTER_AUTH_URL is not set: set it to the public origin, e.g. https://example.com'
		);
	return baseUrl;
}

// Response headers every answer of the app carries (#66). The page CSP itself is built by
// SvelteKit (`csp` in vite.config.ts, with nonces); this module adds what is only known at run time.

/** Sign-in goes through a plain form POST that answers 303 to these hosts; Chrome applies `form-action` to that redirect too. */
export const SIGN_IN_ORIGINS = ['https://accounts.google.com', 'https://access.line.me'] as const;

/** CSP of an answer SvelteKit did not render as a page (API, Better Auth, plain-text errors): it loads nothing. */
export const NON_PAGE_CSP = "default-src 'none'; frame-ancestors 'none'";

const STATIC_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	// The CSP `frame-ancestors` is the real control; this is for browsers that predate it.
	'x-frame-options': 'DENY',
	'referrer-policy': 'strict-origin-when-cross-origin',
	// Photos are chosen with <input type="file">, which the camera policy does not cover.
	'permissions-policy':
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=()'
};

/** The origin of `R2_PUBLIC_BASE_URL`; null when unset or not a URL (nothing to allow). */
export function photoOrigin(base: string | undefined): string | null {
	if (!base) return null;
	try {
		const { origin } = new URL(base);
		return origin === 'null' ? null : origin;
	} catch {
		return null;
	}
}

/** `csp` with `origin` added to its `img-src` (or an `img-src` made from `default-src`'s sources). */
export function allowImageOrigin(csp: string, origin: string | null): string {
	if (!origin) return csp;
	const directives = csp.split(';').map((d) => d.trim());
	const at = directives.findIndex((d) => /^img-src(\s|$)/i.test(d));
	if (at !== -1) directives[at] += ` ${origin}`;
	else {
		const fallback = directives.find((d) => /^default-src(\s|$)/i.test(d));
		if (!fallback) return csp; // no img-src and no default-src: images are not restricted
		directives.push(`img-src ${fallback.slice('default-src'.length).trim()} ${origin}`);
	}
	return directives.join('; ');
}

/** Sets the headers on `response`; a response with immutable headers (a fetched one) is copied first. */
export function withSecurityHeaders(response: Response, imageOrigin: string | null): Response {
	const csp = response.headers.get('content-security-policy');
	const headers = {
		...STATIC_HEADERS,
		'content-security-policy': csp ? allowImageOrigin(csp, imageOrigin) : NON_PAGE_CSP
	};
	try {
		for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
		return response;
	} catch {
		const copy = new Response(response.body, response);
		for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
		return copy;
	}
}

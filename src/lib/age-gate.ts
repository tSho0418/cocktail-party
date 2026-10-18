// Age Gate (FR-060..062). Shared by the layout load, the consent endpoint and the e2e config,
// so the cookie name and lifetime live only here.

export const AGE_GATE_COOKIE = 'age_gate_consent';
export const AGE_GATE_COOKIE_VALUE = '1';
export const AGE_GATE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // FR-061: 30 days

/** Query parameter that makes the gate show the "under 20" message instead of the question. */
export const AGE_GATE_DECLINED_PARAM = 'age-gate';

export const ageGateCookieOptions = {
	path: '/',
	maxAge: AGE_GATE_MAX_AGE_SECONDS,
	httpOnly: true,
	sameSite: 'lax'
} as const;

/** The gate is open until the visitor has the consent cookie. */
export const isAgeGateOpen = (cookieValue: string | undefined) =>
	cookieValue !== AGE_GATE_COOKIE_VALUE;

/**
 * A same-origin path to send the visitor back to after consenting; anything else (absolute or
 * protocol-relative URLs, backslashes, control characters) falls back to `/`, so the endpoint
 * is not an open redirect.
 */
export function safeReturnPath(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/')) return '/';
	if (value.startsWith('//') || [...value].some((c) => c === '\\' || c.charCodeAt(0) < 0x20))
		return '/';
	return value;
}

type PageUrl = Pick<URL, 'pathname' | 'search'>;

const params = (url: PageUrl) => new URLSearchParams(url.search);

/** `pathname + search` of `url`, with the declined marker set or removed. */
export function pathWithDeclined(url: PageUrl, declined: boolean): string {
	const search = params(url);
	if (declined) search.set(AGE_GATE_DECLINED_PARAM, 'declined');
	else search.delete(AGE_GATE_DECLINED_PARAM);
	const query = search.toString();
	return query ? `${url.pathname}?${query}` : url.pathname;
}

export const isDeclined = (url: PageUrl) => params(url).get(AGE_GATE_DECLINED_PARAM) === 'declined';

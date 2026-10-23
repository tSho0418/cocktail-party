import { describe, expect, it } from 'vitest';
import {
	NON_PAGE_CSP,
	allowImageOrigin,
	photoOrigin,
	withSecurityHeaders
} from './security-headers';

describe('photoOrigin', () => {
	it('is the origin of the public base URL, without its path', () => {
		expect(photoOrigin('https://img.example.com/photos/')).toBe('https://img.example.com');
	});

	it.each([undefined, '', 'not a url', 'data:text/plain,x'])('is null for %j', (base) => {
		expect(photoOrigin(base)).toBeNull();
	});
});

describe('allowImageOrigin', () => {
	it('adds the origin to img-src only', () => {
		expect(
			allowImageOrigin(
				"default-src 'self'; img-src 'self' data:; form-action 'self'",
				'https://i.example'
			)
		).toBe("default-src 'self'; img-src 'self' data: https://i.example; form-action 'self'");
	});

	it('leaves the policy alone when there is no origin (R2_PUBLIC_BASE_URL unset)', () => {
		const csp = "default-src 'self'; img-src 'self'";
		expect(allowImageOrigin(csp, null)).toBe(csp);
	});

	it('builds img-src from default-src when the policy has none', () => {
		expect(allowImageOrigin("default-src 'self'", 'https://i.example')).toBe(
			"default-src 'self'; img-src 'self' https://i.example"
		);
	});
});

describe('withSecurityHeaders', () => {
	it('sets the fixed headers and the restrictive CSP on a response without a page CSP', () => {
		const res = withSecurityHeaders(Response.json({ ok: true }), 'https://i.example');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('permissions-policy')).toContain('camera=()');
		expect(res.headers.get('content-security-policy')).toBe(NON_PAGE_CSP);
	});

	it("extends a page's CSP with the photo origin and keeps its own directives", () => {
		const page = new Response('<p>', {
			headers: { 'content-security-policy': "img-src 'self'; frame-ancestors 'none'" }
		});
		expect(
			withSecurityHeaders(page, 'https://i.example').headers.get('content-security-policy')
		).toBe("img-src 'self' https://i.example; frame-ancestors 'none'");
	});

	it('also works on a response whose headers are immutable', async () => {
		const res = withSecurityHeaders(Response.redirect('https://example.com/', 302), null);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://example.com/');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});
});

import { describe, expect, it } from 'vitest';
import { requireBaseUrlOnVercel } from './config';

describe('requireBaseUrlOnVercel', () => {
	it('refuses to run on Vercel without BETTER_AUTH_URL', () => {
		expect(() => requireBaseUrlOnVercel(undefined, true)).toThrow(/BETTER_AUTH_URL/);
		expect(() => requireBaseUrlOnVercel('', true)).toThrow(/BETTER_AUTH_URL/);
	});

	it('returns the URL when it is set', () => {
		expect(requireBaseUrlOnVercel('https://example.com', true)).toBe('https://example.com');
	});

	it('lets a local run or a test leave it unset', () => {
		expect(requireBaseUrlOnVercel(undefined, false)).toBeUndefined();
	});
});

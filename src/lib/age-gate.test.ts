import { describe, expect, it } from 'vitest';
import {
	AGE_GATE_MAX_AGE_SECONDS,
	ageGateCookieOptions,
	isAgeGateOpen,
	isDeclined,
	pathWithDeclined,
	safeReturnPath
} from './age-gate';

describe('age gate', () => {
	it('keeps consent for 30 days (FR-061)', () => {
		expect(AGE_GATE_MAX_AGE_SECONDS).toBe(2_592_000);
		expect(ageGateCookieOptions.maxAge).toBe(AGE_GATE_MAX_AGE_SECONDS);
	});

	it('is open until the consent cookie is present', () => {
		expect(isAgeGateOpen(undefined)).toBe(true);
		expect(isAgeGateOpen('')).toBe(true);
		expect(isAgeGateOpen('0')).toBe(true);
		expect(isAgeGateOpen('1')).toBe(false);
	});

	it('only returns to same-origin paths', () => {
		expect(safeReturnPath('/recipes/1?x=y')).toBe('/recipes/1?x=y');
		for (const bad of [
			undefined,
			'',
			'recipes',
			'https://evil.example/',
			'//evil.example',
			'/\\evil.example',
			'/a\nb'
		])
			expect(safeReturnPath(bad)).toBe('/');
	});

	it('toggles the declined marker and keeps the other query parameters', () => {
		const url = new URL('http://localhost/recipes?q=gin');
		const declined = pathWithDeclined(url, true);
		expect(declined).toBe('/recipes?q=gin&age-gate=declined');
		expect(isDeclined(new URL(declined, url))).toBe(true);
		expect(pathWithDeclined(new URL(declined, url), false)).toBe('/recipes?q=gin');
		expect(isDeclined(url)).toBe(false);
	});
});

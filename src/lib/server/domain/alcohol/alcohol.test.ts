import { describe, expect, it } from 'vitest';
import {
	computeAutoAbv,
	deriveBases,
	hasAlcohol,
	isNonAlcoholic,
	reconcileOverrideAfterIngredientChange,
	recomputeDerived,
	resolveEffectiveAbv,
	roundAbv,
	validateAbvOverride,
	validateMixRatio
} from '.';

const gin = { id: 'gin', mixRatio: 6, abvPercent: 40, isBaseSpirit: true };
const vermouth = { id: 'vermouth', mixRatio: 1, abvPercent: 15, isBaseSpirit: false };
const tonic = { id: 'tonic', mixRatio: 3, abvPercent: 0, isBaseSpirit: false };

describe('computeAutoAbv', () => {
	it('weights ABV by Mix Ratio (Martini 6:1)', () => {
		expect(computeAutoAbv([gin, vermouth])).toBeCloseTo(255 / 7, 12);
	});

	it('is 0 for a 0%-only Recipe', () => {
		expect(computeAutoAbv([tonic, { mixRatio: 1, abvPercent: 0 }])).toBe(0);
	});

	it('handles a 0.1-ratio strong Ingredient', () => {
		expect(
			computeAutoAbv([
				{ mixRatio: 0.1, abvPercent: 96 },
				{ mixRatio: 99.9, abvPercent: 0 }
			])
		).toBeCloseTo(0.096, 12);
	});

	it('rejects an empty Recipe', () => {
		expect(() => computeAutoAbv([])).toThrow(RangeError);
	});
});

describe('hasAlcohol / isNonAlcoholic', () => {
	it('is true when any Ingredient is above 0%', () => {
		expect(hasAlcohol([tonic, vermouth])).toBe(true);
		expect(isNonAlcoholic([tonic, vermouth])).toBe(false);
	});

	it('is Non-alcoholic when every Ingredient is 0%', () => {
		expect(hasAlcohol([tonic])).toBe(false);
		expect(isNonAlcoholic([tonic])).toBe(true);
	});
});

describe('validateMixRatio', () => {
	it.each([0.1, 0.3, 1, 12.5, 99.9, Number('45.6')])('accepts %s', (r) => {
		expect(validateMixRatio(r)).toEqual({ ok: true, value: r });
	});

	it.each([0, 0.05, 100, -1, Infinity])('rejects %s as out of range', (r) => {
		const result = validateMixRatio(r);
		expect(result.ok).toBe(false);
	});

	it.each([0.15, 1.23, 0.1 + 0.2, NaN])('rejects %s as having too many decimals', (r) => {
		expect(validateMixRatio(r)).toEqual({ ok: false, error: 'too_many_decimals' });
	});
});

describe('validateAbvOverride', () => {
	const base = { hasAlcohol: true, maxIngredientAbv: 40 };

	it.each([
		[0, 'out_of_range'],
		[-1, 'out_of_range'],
		[40.1, 'out_of_range'],
		[0.01, 'too_many_decimals']
	])('rejects %s (%s)', (override, error) => {
		expect(validateAbvOverride({ ...base, override })).toEqual({ ok: false, error });
	});

	it.each([0.1, 20, 40])('accepts %s', (override) => {
		expect(validateAbvOverride({ ...base, override })).toEqual({ ok: true, value: override });
	});

	it('rejects any override on a Recipe without alcohol', () => {
		expect(validateAbvOverride({ override: 5, hasAlcohol: false, maxIngredientAbv: 0 })).toEqual({
			ok: false,
			error: 'no_alcohol'
		});
	});
});

describe('resolveEffectiveAbv', () => {
	it('prefers the override when present', () => {
		expect(resolveEffectiveAbv({ autoAbv: 36.4, hasAlcohol: true, override: 30 })).toEqual({
			value: 30,
			isOverride: true
		});
	});

	it('falls back to the automatic value', () => {
		expect(resolveEffectiveAbv({ autoAbv: 36.4, hasAlcohol: true, override: null })).toEqual({
			value: 36.4,
			isOverride: false
		});
	});

	it('is fixed at 0 without alcohol', () => {
		expect(resolveEffectiveAbv({ autoAbv: 0, hasAlcohol: false, override: 5 })).toEqual({
			value: 0,
			isOverride: false
		});
	});
});

describe('reconcileOverrideAfterIngredientChange', () => {
	it('keeps an override that is still in range', () => {
		expect(
			reconcileOverrideAfterIngredientChange({
				override: 30,
				hasAlcohol: true,
				maxIngredientAbv: 40
			})
		).toEqual({ override: 30, discarded: false });
	});

	it('discards an override above the new highest ABV', () => {
		expect(
			reconcileOverrideAfterIngredientChange({
				override: 30,
				hasAlcohol: true,
				maxIngredientAbv: 25
			})
		).toEqual({ override: null, discarded: true });
	});

	it('discards an override when the Recipe no longer has alcohol', () => {
		expect(
			reconcileOverrideAfterIngredientChange({
				override: 5,
				hasAlcohol: false,
				maxIngredientAbv: 0
			})
		).toEqual({ override: null, discarded: true });
	});

	it('does nothing without an override', () => {
		expect(
			reconcileOverrideAfterIngredientChange({
				override: null,
				hasAlcohol: true,
				maxIngredientAbv: 40
			})
		).toEqual({ override: null, discarded: false });
	});
});

describe('deriveBases', () => {
	it('returns every Base, de-duplicated, in first-seen order', () => {
		expect(
			deriveBases([
				{ id: 'rum', isBaseSpirit: true },
				{ id: 'lime', isBaseSpirit: false },
				{ id: 'gin', isBaseSpirit: true },
				{ id: 'rum', isBaseSpirit: true }
			])
		).toEqual(['rum', 'gin']);
	});
});

describe('roundAbv', () => {
	it.each([
		[255 / 7, 36.4],
		[0.15, 0.2],
		[0.096, 0.1],
		[0.04, 0],
		[100, 100]
	])('rounds %s to %s', (n, expected) => {
		expect(roundAbv(n)).toBe(expected);
	});
});

describe('recomputeDerived', () => {
	it('derives the Recipe columns for a Martini', () => {
		expect(recomputeDerived([gin, vermouth])).toEqual({
			autoAbv: 36.4,
			hasAlcohol: true,
			maxIngredientAbv: 40,
			baseIngredientIds: ['gin']
		});
	});

	it('derives a Non-alcoholic Recipe as 0', () => {
		expect(recomputeDerived([tonic])).toEqual({
			autoAbv: 0,
			hasAlcohol: false,
			maxIngredientAbv: 0,
			baseIngredientIds: []
		});
	});

	it('keeps multiple Bases', () => {
		const rum = { id: 'rum', mixRatio: 1, abvPercent: 40, isBaseSpirit: true };
		expect(recomputeDerived([gin, rum, tonic]).baseIngredientIds).toEqual(['gin', 'rum']);
	});
});

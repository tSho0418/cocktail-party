import { describe, expect, it } from 'vitest';
import {
	hasErrors,
	parseMixRatio,
	previewAlcohol,
	toPayload,
	validateForm,
	type FormValues,
	type IngredientOption,
	type IngredientRow
} from './recipe-form';

const gin: IngredientOption = { id: 'gin', name: 'ジン', abvPercent: 40, isBaseSpirit: true };
const vermouth: IngredientOption = {
	id: 'vm',
	name: 'ベルモット',
	abvPercent: 18,
	isBaseSpirit: false
};
const tonic: IngredientOption = {
	id: 'tonic',
	name: 'トニック',
	abvPercent: 0,
	isBaseSpirit: false
};

const row = (rowId: number, ingredient: IngredientOption, mixRatio: string): IngredientRow => ({
	rowId,
	ingredient,
	mixRatio
});

const valid = (over: Partial<FormValues> = {}): FormValues => ({
	title: 'ジントニック',
	description: '',
	mainPhoto: { key: 'recipe/a/list.webp', url: null },
	extraPhotos: [],
	ingredients: [row(1, gin, '1'), row(2, tonic, '3')],
	steps: ['氷を入れる'],
	abvOverride: '',
	...over
});

describe('parseMixRatio (FR-005)', () => {
	it.each([
		['0.1', 0.1],
		['99.9', 99.9],
		[' 1.5 ', 1.5]
	])('accepts %s', (text, n) => expect(parseMixRatio(text)).toBe(n));

	it.each(['', 'abc', '0', '0.05', '100', '1.25', '-1'])('rejects %j', (text) =>
		expect(parseMixRatio(text)).toBeNull()
	);
});

describe('previewAlcohol (FR-020..024)', () => {
	it('weights Ingredient ABV by Mix Ratio, rounded like the server', () => {
		const p = previewAlcohol([row(1, gin, '1'), row(2, tonic, '3')], '');
		expect(p).toMatchObject({
			hasAlcohol: true,
			autoAbv: 10,
			effectiveAbv: 10,
			maxIngredientAbv: 40
		});
	});

	it('is fixed at 0% without alcohol, and ignores an override (FR-024)', () => {
		const p = previewAlcohol([row(1, tonic, '1')], '5');
		expect(p).toMatchObject({ hasAlcohol: false, autoAbv: 0, effectiveAbv: 0 });
		expect(p.override.state).toBe('none');
	});

	it('shows nothing until a row has a valid Mix Ratio, and skips incomplete rows', () => {
		expect(previewAlcohol([row(1, gin, '')], '').autoAbv).toBeNull();
		expect(previewAlcohol([row(1, gin, '1'), row(2, tonic, 'x')], '').autoAbv).toBe(40);
	});

	it('judges alcohol and the override range by the chosen Ingredients, not their Mix Ratios', () => {
		// A half-typed ratio ("" or "0" on the way to "0.5") must not make the override disappear.
		for (const ratio of ['', '0', 'x']) {
			const p = previewAlcohol([row(1, gin, ratio), row(2, tonic, '3')], '12');
			expect(p).toMatchObject({
				hasAlcohol: true,
				maxIngredientAbv: 40,
				override: { state: 'valid', value: 12 }
			});
		}
		expect(previewAlcohol([row(1, gin, ''), row(2, tonic, '3')], '').autoAbv).toBe(0);
		expect(previewAlcohol([row(1, tonic, ''), row(2, tonic, '')], '5').hasAlcohol).toBe(false);
	});

	it('counts a duplicate Ingredient once', () => {
		expect(previewAlcohol([row(1, gin, '1'), row(2, gin, '1')], '').autoAbv).toBe(40);
	});

	it('applies a valid override and reports the range from the highest Ingredient ABV (FR-021/022)', () => {
		const rows = [row(1, gin, '1'), row(2, tonic, '3')];
		expect(previewAlcohol(rows, '12.5')).toMatchObject({
			override: { state: 'valid', value: 12.5 },
			effectiveAbv: 12.5,
			autoAbv: 10
		});
		for (const bad of ['0', '40.1', '5.55', 'abc'])
			expect(previewAlcohol(rows, bad).override.state).toBe('invalid');
		expect(previewAlcohol(rows, '40').override.state).toBe('valid');
	});

	it('keeps the override through an Ingredient edit while it still fits, rejects it when not (FR-023)', () => {
		const rows = [row(1, gin, '1'), row(2, tonic, '3')];
		expect(previewAlcohol([...rows, row(3, vermouth, '1')], '30').override.state).toBe('valid');
		expect(previewAlcohol([row(2, vermouth, '1'), row(3, tonic, '1')], '30').override.state).toBe(
			'invalid'
		);
	});
});

describe('validateForm', () => {
	it('passes a complete form', () => {
		expect(hasErrors(validateForm(valid()))).toBe(false);
	});

	it('requires the Main Photo (FR-007), a title, an Ingredient and a step', () => {
		const e = validateForm(valid({ mainPhoto: null, title: ' ', ingredients: [], steps: [] }));
		expect(e).toMatchObject({
			mainPhoto: expect.any(String),
			title: expect.any(String),
			ingredients: expect.any(String),
			steps: expect.any(String)
		});
	});

	it('counts code points, not UTF-16 units', () => {
		expect(validateForm(valid({ title: '🍸'.repeat(50) })).title).toBeUndefined();
		expect(validateForm(valid({ title: '🍸'.repeat(51) })).title).toBeDefined();
	});

	it('flags a duplicate Ingredient and a bad Mix Ratio on their rows (FR-004/005)', () => {
		const e = validateForm(
			valid({ ingredients: [row(1, gin, '1'), row(2, gin, '1'), row(3, tonic, '0')] })
		);
		expect(Object.keys(e.rows)).toEqual(['2', '3']);
	});

	it('flags an empty or over-long step by index (FR-006)', () => {
		const e = validateForm(valid({ steps: ['a', ' ', 'あ'.repeat(201)] }));
		expect(Object.keys(e.stepRows)).toEqual(['1', '2']);
	});

	it('blocks an override that no longer fits', () => {
		expect(validateForm(valid({ abvOverride: '50' })).abvOverride).toContain('40%');
	});
});

describe('toPayload', () => {
	it('sends trimmed text, list keys and Mix Ratios as numbers', () => {
		const payload = toPayload(
			valid({
				title: ' ジントニック ',
				extraPhotos: [{ key: 'recipe/b/list.webp', url: null }],
				steps: [' 氷を入れる ', 'ステア']
			})
		);
		expect(payload).toEqual({
			title: 'ジントニック',
			description: '',
			mainPhotoKey: 'recipe/a/list.webp',
			extraPhotoKeys: ['recipe/b/list.webp'],
			ingredients: [
				{ ingredientId: 'gin', mixRatio: 1 },
				{ ingredientId: 'tonic', mixRatio: 3 }
			],
			steps: ['氷を入れる', 'ステア'],
			abvOverride: null
		});
	});

	it('sends the override only when it is valid and the Recipe has alcohol', () => {
		expect(toPayload(valid({ abvOverride: '12.5' })).abvOverride).toBe(12.5);
		expect(
			toPayload(valid({ ingredients: [row(1, tonic, '1')], abvOverride: '12.5' })).abvOverride
		).toBeNull();
	});
});

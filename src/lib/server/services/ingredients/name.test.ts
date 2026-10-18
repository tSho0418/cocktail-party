import { describe, expect, it } from 'vitest';
import { ingredientNameKey, normalizeIngredientName } from './name';

describe('ingredient names', () => {
	it('folds width, spaces and case', () => {
		expect(normalizeIngredientName('  ＤＲＹ　ｼﾞﾝ  ')).toBe('DRY ジン');
		expect(ingredientNameKey('ＤＲＹ　ｼﾞﾝ')).toBe(ingredientNameKey('dry ジン'));
	});
});

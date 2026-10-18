import { describe, expect, it } from 'vitest';
import { emptySearchForm, isFiltered, parseSearchQuery, searchQuery } from './search-query';

describe('search query', () => {
	it('round-trips a full search, keeping repeated Ingredients and Bases', () => {
		const url =
			'?q=%E3%83%9F%E3%83%B3%E3%83%88&ing=a&ing=b&only=1&base=c&abvMin=3&abvMax=9.5&na=1&sort=like';
		const { form, cursor } = parseSearchQuery(new URLSearchParams(url));
		expect(form).toEqual({
			keyword: 'ミント',
			ingredientIds: ['a', 'b'],
			onlyThese: true,
			baseIds: ['c'],
			abvMin: '3',
			abvMax: '9.5',
			nonAlcoholic: true,
			sort: 'like'
		});
		expect(cursor).toBeNull();
		expect([...new URLSearchParams(searchQuery(form))]).toEqual([...new URLSearchParams(url)]);
	});

	it('treats an empty or unknown query as the default newest-first list', () => {
		const { form } = parseSearchQuery(new URLSearchParams('sort=bogus&q=&ing=&only=yes'));
		expect(form).toEqual(emptySearchForm());
		expect(searchQuery(form)).toBe('');
		expect(isFiltered(form)).toBe(false);
	});

	it('appends the cursor after the search, and the sort alone is not a filter', () => {
		const form = { ...emptySearchForm(), sort: 'like' as const };
		expect(searchQuery(form, 'abc')).toBe('?sort=like&cursor=abc');
		expect(isFiltered(form)).toBe(false);
		expect(isFiltered({ ...form, keyword: 'x' })).toBe(true);
	});
});

// The top page's search form <-> URL query (FR-040..045). Shared by the load function, which
// parses it, and the page, which builds links that keep the current search.

export type SearchSort = 'new' | 'like';

/** Everything the search form holds. Numbers stay strings so the inputs show what was typed. */
export type SearchForm = {
	keyword: string;
	ingredientIds: string[];
	onlyThese: boolean;
	baseIds: string[];
	abvMin: string;
	abvMax: string;
	nonAlcoholic: boolean;
	sort: SearchSort;
};

export const emptySearchForm = (): SearchForm => ({
	keyword: '',
	ingredientIds: [],
	onlyThese: false,
	baseIds: [],
	abvMin: '',
	abvMax: '',
	nonAlcoholic: false,
	sort: 'new'
});

export function parseSearchQuery(query: URLSearchParams): {
	form: SearchForm;
	cursor: string | null;
} {
	const text = (name: string) => query.get(name)?.trim() ?? '';
	const all = (name: string) => [...new Set(query.getAll(name).filter(Boolean))];
	return {
		form: {
			keyword: text('q'),
			ingredientIds: all('ing'),
			onlyThese: query.get('only') === '1',
			baseIds: all('base'),
			abvMin: text('abvMin'),
			abvMax: text('abvMax'),
			nonAlcoholic: query.get('na') === '1',
			sort: query.get('sort') === 'like' ? 'like' : 'new'
		},
		cursor: query.get('cursor') || null
	};
}

/** `?...` for `form` (empty string when it is the default list), plus `cursor` for a later page. */
export function searchQuery(form: SearchForm, cursor?: string | null): string {
	const q = new URLSearchParams();
	if (form.keyword) q.set('q', form.keyword);
	for (const id of form.ingredientIds) q.append('ing', id);
	if (form.onlyThese) q.set('only', '1');
	for (const id of form.baseIds) q.append('base', id);
	if (form.abvMin) q.set('abvMin', form.abvMin);
	if (form.abvMax) q.set('abvMax', form.abvMax);
	if (form.nonAlcoholic) q.set('na', '1');
	if (form.sort !== 'new') q.set('sort', form.sort);
	if (cursor) q.set('cursor', cursor);
	const s = q.toString();
	return s ? `?${s}` : '';
}

/** True when any condition narrows the list (the sort alone does not). */
export const isFiltered = (form: SearchForm) => searchQuery({ ...form, sort: 'new' }) !== '';

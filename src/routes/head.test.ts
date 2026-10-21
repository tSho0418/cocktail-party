import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { emptySearchForm } from '#lib/search-query.js';
import Home from './+page.svelte';
import RecipePage from './recipes/[id]/+page.svelte';

const state = vi.hoisted(() => ({ url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: state }));

const homeHead = (search: string) => {
	state.url = new URL(`http://localhost/${search}`);
	const data = {
		form: emptySearchForm(),
		ingredients: [],
		recipes: [],
		nextQuery: null,
		firstQuery: '',
		hasCursor: false,
		filtered: false
	};
	return render(Home, { props: { data } as never }).head;
};

describe('top page head (NFR-007)', () => {
	it('is indexable only at the bare /', () => {
		expect(homeHead('')).not.toContain('noindex');
	});

	it.each([
		'?q=gin',
		'?ing=1',
		'?only=1',
		'?sort=like',
		'?cursor=abc',
		// An untouched search form submits these; the page is the same as `/`.
		'?q=&sort=new&abvMin=&abvMax=',
		'?utm_source=x'
	])('asks not to index %s', (search) => {
		expect(homeHead(search)).toContain('<meta name="robots" content="noindex"');
	});
});

const recipeHead = (
	over: { title?: string; description?: string; mainPhotoUrl?: string | null } = {}
) => {
	state.url = new URL('http://localhost/recipes/abc?utm=1');
	const recipe = {
		id: 'abc',
		title: over.title ?? 'ジントニック',
		description: over.description ?? '',
		ingredients: [
			{ id: 'i1', name: 'ジン', mixRatio: 1 },
			{ id: 'i2', name: 'トニック', mixRatio: 3 }
		],
		steps: [],
		bases: [],
		owner: { username: 'alice' },
		createdAt: new Date(0),
		likeCount: 0,
		isNonAlcoholic: false,
		effectiveAbv: 10,
		autoAbv: 10,
		isOverride: false
	};
	const data = {
		recipe,
		mainPhotoUrl: over.mainPhotoUrl ?? null,
		extraPhotoUrls: [],
		reactions: { likeCount: 0, liked: false, saved: false },
		signedIn: false,
		isOwner: false,
		canEdit: false,
		canDelete: false
	};
	return render(RecipePage, { props: { data } as never }).head;
};

describe('Recipe detail head (FR-080)', () => {
	beforeEach(() => {
		state.url = new URL('http://localhost/');
	});

	it('escapes quotes, angle brackets and ampersands in the title and meta content', () => {
		const head = recipeHead({ title: `"A" <b> & C`, description: `"d" <i> & e` });
		expect(head).toContain('<title>"A" &lt;b> &amp; C | Cocktail Party</title>');
		expect(head).not.toContain('<b>');
		expect(head).toContain('content="&quot;A&quot; &lt;b> &amp; C"');
		expect(head).toContain('content="&quot;d&quot; &lt;i> &amp; e"');
	});

	it('uses the large card and og:image only with a Main Photo', () => {
		const withPhoto = recipeHead({ mainPhotoUrl: 'https://img.example/x.webp' });
		expect(withPhoto).toContain('name="twitter:card" content="summary_large_image"');
		expect(withPhoto).toContain('property="og:image" content="https://img.example/x.webp"');

		const without = recipeHead({ mainPhotoUrl: null });
		expect(without).toContain('name="twitter:card" content="summary"');
		expect(without).not.toContain('og:image');
	});

	it('describes the Recipe from its Ingredients when the description is blank', () => {
		expect(recipeHead({ description: '  ' })).toContain(
			'name="description" content="ジントニックのレシピ。材料: ジン、トニック"'
		);
		expect(recipeHead({ description: '爽やかな一杯' })).toContain(
			'name="description" content="爽やかな一杯"'
		);
	});

	it('points og:url at the page without its query string', () => {
		expect(recipeHead()).toContain('property="og:url" content="http://localhost/recipes/abc"');
	});
});

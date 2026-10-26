import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { photoFiles } from './photos';

describe('photoFiles (what a withdrawal deletes for a stored key, #48)', () => {
	const id = randomUUID();

	it.each([
		[`recipe/${id}/list.webp`, 'recipe'],
		[`recipe/${id}/detail.webp`, 'recipe'],
		[`member/${id}/list.webp`, 'member']
	])('pairs %s with the other size of the same photo', (key, kind) => {
		expect(photoFiles(key)).toEqual([`${kind}/${id}/list.webp`, `${kind}/${id}/detail.webp`]);
	});

	// A key that is not exactly what storePhoto writes is returned as it is: never widened to
	// another object, so it cannot be used to delete anything beyond what the key names.
	it.each([
		`recipe/../member/${id}/list.webp`,
		`recipe/${id}/../${randomUUID()}/list.webp`,
		`recipe/${id}/list.webp/..`,
		`/recipe/${id}/list.webp`,
		`x/recipe/${id}/list.webp`,
		`recipe/${id.toUpperCase()}/list.webp`,
		`recipe/${id}/other.webp`,
		`recipe/${id}/list.webp\n`,
		`other/${id}/list.webp`,
		'photos/main-1',
		''
	])('returns the malformed key %j alone', (key) => {
		expect(photoFiles(key)).toEqual([key]);
	});
});

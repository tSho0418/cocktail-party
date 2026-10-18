import { describe, expect, it } from 'vitest';
import { photoUrl } from './url';

const BASE = 'https://img.example.com/';
const ID = 'recipe/6f0c8a1e-0000-4000-8000-000000000001';

describe('photoUrl', () => {
	it('derives either size from whichever key of the pair is stored', () => {
		expect(photoUrl(`${ID}/list.webp`, 'detail', BASE)).toBe(
			`https://img.example.com/${ID}/detail.webp`
		);
		expect(photoUrl(`${ID}/detail.webp`, 'list', BASE)).toBe(
			`https://img.example.com/${ID}/list.webp`
		);
		expect(photoUrl(`${ID}/list.webp`, 'list', BASE)).toBe(
			`https://img.example.com/${ID}/list.webp`
		);
	});

	it('uses other keys as they are', () => {
		expect(photoUrl('photos/x/main', 'list', BASE)).toBe('https://img.example.com/photos/x/main');
	});

	it('is null without a public base URL', () => {
		expect(photoUrl(`${ID}/list.webp`, 'list', undefined)).toBeNull();
		expect(photoUrl(`${ID}/list.webp`, 'list', '')).toBeNull();
	});
});

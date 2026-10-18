import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const env = vi.hoisted(() => ({ E2E_HARNESS: undefined as string | undefined }));
vi.mock('$app/env/private', () => env);

const { load } = await import('./+page.server');

describe('/dev/ingredient-picker', () => {
	it('is 404 without E2E_HARNESS=1 (production)', () => {
		for (const flag of [undefined, '', 'true']) {
			env.E2E_HARNESS = flag;
			try {
				load();
				expect.unreachable();
			} catch (e) {
				expect(isHttpError(e, 404)).toBe(true);
			}
		}
	});

	it('loads with E2E_HARNESS=1', () => {
		env.E2E_HARNESS = '1';
		expect(load()).toBeUndefined();
	});
});

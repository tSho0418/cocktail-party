import { error } from '@sveltejs/kit';
import { E2E_HARNESS } from '$app/env/private';

// Test harness only: hidden from production builds unless Playwright sets the flag.
export const load = () => {
	if (E2E_HARNESS !== '1') error(404);
};

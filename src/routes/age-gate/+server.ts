import { redirect } from '@sveltejs/kit';
import {
	AGE_GATE_COOKIE,
	AGE_GATE_COOKIE_VALUE,
	ageGateCookieOptions,
	safeReturnPath
} from '#lib/age-gate.js';
import type { RequestHandler } from './$types';

/** The visitor declared 20+ (FR-060): remember it for 30 days (FR-061) and go back. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const form = await request.formData();
	cookies.set(AGE_GATE_COOKIE, AGE_GATE_COOKIE_VALUE, ageGateCookieOptions);
	redirect(303, safeReturnPath(form.get('redirectTo')));
};

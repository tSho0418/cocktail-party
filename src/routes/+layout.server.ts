import { AGE_GATE_COOKIE, isAgeGateExempt, isAgeGateOpen } from '#lib/age-gate.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies, locals, url }) => ({
	ageGateOpen: !isAgeGateExempt(url.pathname) && isAgeGateOpen(cookies.get(AGE_GATE_COOKIE)),
	// Only what the header shows; null when signed out.
	member: locals.member
		? { username: locals.member.username, isAdministrator: locals.member.isAdministrator }
		: null
});

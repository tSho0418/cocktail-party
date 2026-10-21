import { AGE_GATE_COOKIE, isAgeGateExempt, isAgeGateOpen } from '#lib/age-gate.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies, url }) => ({
	ageGateOpen: !isAgeGateExempt(url.pathname) && isAgeGateOpen(cookies.get(AGE_GATE_COOKIE))
});

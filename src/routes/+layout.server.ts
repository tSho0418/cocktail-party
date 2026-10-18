import { AGE_GATE_COOKIE, isAgeGateOpen } from '#lib/age-gate.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => ({
	ageGateOpen: isAgeGateOpen(cookies.get(AGE_GATE_COOKIE))
});

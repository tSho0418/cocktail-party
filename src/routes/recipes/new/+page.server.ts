import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Members only (FR-001); a signed-out visitor is sent to log in. A Member without a Username
// never gets here: the auth handle redirects them to /welcome (FR-052).
export const load: PageServerLoad = ({ locals }) => {
	if (!locals.member) redirect(303, '/login');
};

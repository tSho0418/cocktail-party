import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { publicUrl } from '#lib/server/services/images/public-url.js';
import {
	getProfile,
	listFollowers,
	listFollowing,
	listMemberRecipes,
	listSavedRecipes,
	type MemberCard,
	type RecipeCard
} from '#lib/server/services/social/index.js';
import type { PageServerLoad } from './$types';

const TABS = ['recipes', 'following', 'followers', 'saved'] as const;
type Tab = (typeof TABS)[number];

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const viewer = locals.member;
	const profile = await getProfile(db, params.username, viewer?.id ?? null);
	if (!profile) error(404, 'メンバーが見つかりません');

	const isSelf = viewer?.id === profile.id;
	const requested = url.searchParams.get('tab');
	const tab: Tab = TABS.find((t) => t === requested) ?? 'recipes';
	// FR-056: the Save list belongs to its owner alone.
	if (tab === 'saved' && !isSelf) error(404, 'ページが見つかりません');
	const opts = { cursor: url.searchParams.get('cursor') };

	const cards = <T extends { mainPhotoKey: string }>(items: T[]) =>
		items.map((r) => ({ ...r, photoUrl: publicUrl(r.mainPhotoKey) }));
	const people = <T extends { iconKey: string | null }>(items: T[]) =>
		items.map((m) => ({ ...m, iconUrl: publicUrl(m.iconKey) }));

	let list:
		| {
				kind: 'recipes';
				items: (RecipeCard & { photoUrl: string | null })[];
				nextCursor: string | null;
		  }
		| {
				kind: 'members';
				items: (MemberCard & { iconUrl: string | null })[];
				nextCursor: string | null;
		  };
	if (tab === 'following') {
		const p = await listFollowing(db, profile.id, opts);
		list = { kind: 'members', items: people(p.items), nextCursor: p.nextCursor };
	} else if (tab === 'followers') {
		const p = await listFollowers(db, profile.id, opts);
		list = { kind: 'members', items: people(p.items), nextCursor: p.nextCursor };
	} else {
		const p = await (tab === 'saved' ? listSavedRecipes : listMemberRecipes)(db, profile.id, opts);
		list = { kind: 'recipes', items: cards(p.items), nextCursor: p.nextCursor };
	}

	return {
		profile: { ...profile, iconUrl: publicUrl(profile.iconKey) },
		isSelf,
		signedIn: !!viewer,
		tab,
		list
	};
};

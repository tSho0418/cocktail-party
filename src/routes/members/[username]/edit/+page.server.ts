import { error, fail, redirect } from '@sveltejs/kit';
import { defaultStore } from '#lib/server/api/photos.js';
import { db } from '#lib/server/db/index.js';
import { deleteObjects } from '#lib/server/services/images/delete-objects.js';
import { publicUrl } from '#lib/server/services/images/public-url.js';
import {
	getProfile,
	updateProfile,
	type UpdateProfileError
} from '#lib/server/services/social/index.js';
import type { Actions, PageServerLoad } from './$types';

const MESSAGES: Record<UpdateProfileError, string> = {
	username_invalid: 'Username は半角英数字とアンダースコア(_)で、3〜20文字にしてください。',
	username_taken: 'この Username は使われています。大文字と小文字は区別しません。',
	bio_too_long: '自己紹介は200文字までです。',
	icon_key_invalid: 'アイコン画像を設定できませんでした。もう一度選んでください。'
};

/** FR-053/054: only the Member themself edits their profile. */
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.member) redirect(303, '/login');
	const profile = await getProfile(db, params.username, locals.member.id);
	if (!profile) error(404, 'メンバーが見つかりません');
	if (profile.id !== locals.member.id) error(403, 'このプロフィールは編集できません');
	return { profile: { ...profile, iconUrl: publicUrl(profile.iconKey) } };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.member) redirect(303, '/login');
		const form = await request.formData();
		const text = (k: string) => String(form.get(k) ?? '');
		const username = text('username').trim();
		const bio = text('bio');
		const newIcon = text('iconKey');
		const iconKey = form.get('removeIcon') ? null : newIcon || undefined;

		const result = await updateProfile(db, locals.member.id, { username, bio, iconKey });
		if (!result.ok) return fail(400, { username, bio, error: MESSAGES[result.error] });
		await deleteObjects(defaultStore, result.value.releasedKeys);
		redirect(303, `/members/${username}`);
	}
};

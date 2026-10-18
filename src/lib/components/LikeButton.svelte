<script lang="ts">
	import { resolve } from '$app/paths';
	import { createApiClient } from '#lib/api.js';

	/**
	 * Like toggle (FR-055). Shows the count only, never who liked. Mount on the Recipe detail page:
	 * `<LikeButton recipeId={id} liked={reactions.liked} likeCount={reactions.likeCount}
	 *   signedIn={!!member} isOwner={recipe.owner.id === member?.id} />`
	 * with `reactions` from `GET /api/recipes/:id/reactions` (or getReactions on the server).
	 */
	let {
		recipeId,
		liked = false,
		likeCount,
		signedIn,
		isOwner = false
	}: {
		recipeId: string;
		liked?: boolean;
		likeCount: number;
		signedIn: boolean;
		isOwner?: boolean;
	} = $props();

	let busy = $state(false);
	let error = $state<string>();

	async function toggle() {
		busy = true;
		error = undefined;
		try {
			const route = createApiClient().api.recipes[':id'].like;
			const res = await (liked
				? route.$delete({ param: { id: recipeId } })
				: route.$put({ param: { id: recipeId } }));
			const body = await res.json();
			if (res.ok && 'liked' in body) {
				liked = body.liked;
				likeCount = body.likeCount;
			} else {
				error = 'いいねを変更できませんでした。';
			}
		} catch {
			error = '通信に失敗しました。';
		} finally {
			busy = false;
		}
	}
</script>

<span class="inline-flex items-center gap-2">
	{#if signedIn && !isOwner}
		<button
			type="button"
			aria-pressed={liked}
			disabled={busy}
			onclick={toggle}
			class="rounded border px-3 py-1 text-sm font-medium {liked
				? 'border-pink-700 bg-pink-50 text-pink-800'
				: 'border-gray-300'}"
		>
			{liked ? '♥ いいね済み' : '♡ いいね'}
		</button>
	{:else if !signedIn}
		<a href={resolve('/(auth)/login')} class="rounded border border-gray-300 px-3 py-1 text-sm"
			>♡ ログインしていいね</a
		>
	{/if}
	<span aria-label="いいね数" class="text-sm text-gray-700">{likeCount}</span>
	{#if error}<span role="alert" class="text-sm text-red-700">{error}</span>{/if}
</span>

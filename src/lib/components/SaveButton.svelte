<script lang="ts">
	import { resolve } from '$app/paths';
	import { createApiClient } from '#lib/api.js';

	/**
	 * Save toggle (FR-056). Saves are private to the Member. Mount on the Recipe detail page:
	 * `<SaveButton recipeId={id} saved={reactions.saved} signedIn={!!member} />`.
	 */
	let {
		recipeId,
		saved = false,
		signedIn
	}: { recipeId: string; saved?: boolean; signedIn: boolean } = $props();

	let busy = $state(false);
	let error = $state<string>();

	async function toggle() {
		busy = true;
		error = undefined;
		try {
			const route = createApiClient().api.recipes[':id'].save;
			const res = await (saved
				? route.$delete({ param: { id: recipeId } })
				: route.$put({ param: { id: recipeId } }));
			const body = await res.json();
			if (res.ok && 'saved' in body) saved = body.saved;
			else error = '保存を変更できませんでした。';
		} catch {
			error = '通信に失敗しました。';
		} finally {
			busy = false;
		}
	}
</script>

<span class="inline-flex items-center gap-2">
	{#if signedIn}
		<button
			type="button"
			aria-pressed={saved}
			disabled={busy}
			onclick={toggle}
			class="rounded border px-3 py-1 text-sm font-medium {saved
				? 'border-gray-900 bg-gray-900 text-white'
				: 'border-gray-300'}"
		>
			{saved ? '保存済み' : '保存する'}
		</button>
	{:else}
		<a href={resolve('/(auth)/login')} class="rounded border border-gray-300 px-3 py-1 text-sm"
			>ログインして保存</a
		>
	{/if}
	{#if error}<span role="alert" class="text-sm text-red-700">{error}</span>{/if}
</span>

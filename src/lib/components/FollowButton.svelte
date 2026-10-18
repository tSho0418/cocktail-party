<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createApiClient } from '#lib/api.js';

	/** Follow toggle (FR-057). Not shown on one's own profile. */
	let {
		username,
		following = false,
		signedIn
	}: { username: string; following?: boolean; signedIn: boolean } = $props();

	let busy = $state(false);
	let error = $state<string>();

	async function toggle() {
		busy = true;
		error = undefined;
		try {
			const route = createApiClient().api.members[':username'].follow;
			const res = await (following
				? route.$delete({ param: { username } })
				: route.$put({ param: { username } }));
			const body = await res.json();
			if (res.ok && 'following' in body) {
				following = body.following;
				await invalidateAll(); // follower counts and lists
			} else {
				error = 'フォローを変更できませんでした。';
			}
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
			aria-pressed={following}
			disabled={busy}
			onclick={toggle}
			class="rounded border px-4 py-1.5 text-sm font-medium {following
				? 'border-gray-300'
				: 'border-gray-900 bg-gray-900 text-white'}"
		>
			{following ? 'フォロー中' : 'フォローする'}
		</button>
	{:else}
		<a href={resolve('/(auth)/login')} class="rounded border border-gray-300 px-4 py-1.5 text-sm"
			>ログインしてフォロー</a
		>
	{/if}
	{#if error}<span role="alert" class="text-sm text-red-700">{error}</span>{/if}
</span>

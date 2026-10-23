<script lang="ts">
	import { resolve } from '$app/paths';
	import PhotoPicker from '#lib/components/PhotoPicker.svelte';
	import { apiErrorMessage } from '#lib/recipe-form.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let iconKey = $state('');
	let previewUrl = $state<string>();
	let uploading = $state(false);
	let uploadError = $state<string>();
	let removeIcon = $state(false);

	async function upload(blob: Blob) {
		uploading = true;
		uploadError = undefined;
		try {
			const res = await fetch('/api/photos?kind=member', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: blob
			});
			const body = await res.json().catch(() => null);
			if (!res.ok || !body?.keys?.list) {
				iconKey = '';
				uploadError = apiErrorMessage(body?.error, 'アイコンをアップロードできませんでした。');
				return;
			}
			iconKey = body.keys.list;
			previewUrl = URL.createObjectURL(blob);
			removeIcon = false;
		} catch {
			iconKey = '';
			uploadError = 'アイコンをアップロードできませんでした。';
		} finally {
			uploading = false;
		}
	}

	const shownIcon = $derived(
		removeIcon ? undefined : (previewUrl ?? data.profile.iconUrl ?? undefined)
	);
</script>

<svelte:head><title>プロフィールを編集 | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-md p-6">
	<h1 class="text-2xl font-bold">プロフィールを編集</h1>

	<form method="POST" class="mt-6 flex flex-col gap-3">
		<div class="flex items-center gap-4">
			{#if shownIcon}
				<img src={shownIcon} alt="現在のアイコン" class="size-16 rounded-full object-cover" />
			{:else}
				<div aria-hidden="true" class="size-16 rounded-full bg-gray-200"></div>
			{/if}
			<div class="flex flex-col gap-1 text-sm">
				<PhotoPicker label="アイコン画像" onselect={upload} />
				{#if uploading}<p role="status">アップロード中…</p>{/if}
				{#if uploadError}<p role="alert" class="text-red-700">{uploadError}</p>{/if}
				{#if data.profile.iconUrl || iconKey}
					<label class="flex items-center gap-1">
						<input type="checkbox" name="removeIcon" bind:checked={removeIcon} />
						アイコンを削除する
					</label>
				{/if}
			</div>
		</div>
		<input type="hidden" name="iconKey" value={iconKey} />

		<label for="username" class="text-sm font-medium">Username</label>
		<input
			id="username"
			name="username"
			required
			minlength="3"
			maxlength="20"
			pattern="[A-Za-z0-9_]+"
			value={form?.username ?? data.profile.username}
			aria-describedby="username-help"
			class="rounded border border-gray-300 px-3 py-2"
		/>
		<p id="username-help" class="text-xs text-gray-500">半角英数字と _、3〜20文字</p>

		<label for="bio" class="text-sm font-medium">自己紹介</label>
		<textarea
			id="bio"
			name="bio"
			rows="4"
			maxlength="200"
			class="rounded border border-gray-300 px-3 py-2"
			>{form?.bio ?? data.profile.bio ?? ''}</textarea
		>
		<p class="text-xs text-gray-500">200文字まで</p>

		{#if form?.error}<p role="alert" class="text-sm text-red-700">{form.error}</p>{/if}
		<div class="mt-2 flex items-center gap-4">
			<button
				disabled={uploading}
				class="rounded bg-gray-900 px-4 py-2 font-medium text-white disabled:opacity-50"
				>保存する</button
			>
			<a
				href={resolve('/members/[username]', { username: data.profile.username })}
				class="text-sm text-gray-600 underline">キャンセル</a
			>
		</div>
	</form>
</main>

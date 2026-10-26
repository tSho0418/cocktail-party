<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>退会の確認 | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-md p-8">
	<h1 class="text-2xl font-bold">退会の確認</h1>
	<p class="mt-4">
		{#if data.username}<strong>{data.username}</strong> を{/if}退会すると、次のデータがすべて削除されます。
	</p>
	<ul class="mt-2 list-inside list-disc text-sm text-gray-800">
		<li>あなたが投稿したレシピと写真</li>
		<li>あなたが付けたいいねと保存したレシピ</li>
		<li>フォローとフォロワーの関係</li>
	</ul>
	<p class="mt-4 text-sm text-gray-800">
		LINE でログインしている場合は、退会すると LY
		Corporation(LINE)に退会したことが通知され、本サービスと LINE アプリの連携が解除されます。
		解除できない場合があります(LINE
		での認証を最後に行ってから長い期間がたっているときなど)。その場合も退会は完了し、連携は、LINE
		アプリの「設定 &gt; アカウント &gt; 連携アプリ」から解除できます。
	</p>
	<p class="mt-4 text-sm font-bold text-red-700">
		退会はすぐに実行され、取り消すことも、元に戻すこともできません。
	</p>

	<form method="POST" class="mt-6 flex items-center gap-4">
		<button class="rounded bg-red-700 px-4 py-2 font-medium text-white">退会する</button>
		<a
			href={data.username
				? resolve('/members/[username]', { username: data.username })
				: resolve('/(auth)/welcome')}
			class="text-sm text-gray-600 underline">やめる</a
		>
	</form>
</main>

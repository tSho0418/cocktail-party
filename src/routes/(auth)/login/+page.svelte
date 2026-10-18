<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head><title>ログイン | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-sm p-8">
	<h1 class="text-2xl font-bold">ログイン</h1>

	{#if page.url.searchParams.has('error')}
		<p role="alert" class="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
			ログインできませんでした。時間をおいて、もう一度お試しください。
		</p>
	{/if}

	<form method="POST" class="mt-6 flex flex-col gap-3">
		<button
			formaction="?/google"
			class="rounded border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50"
		>
			Google でログイン
		</button>
		<button formaction="?/line" class="rounded bg-[#06C755] px-4 py-2 font-medium text-white">
			LINE でログイン
		</button>
	</form>

	<!-- FR-051, ADR 0005 -->
	<p class="mt-6 text-sm text-gray-600">
		Google と LINE
		は別のアカウントとして扱います。前回と違う方法でログインすると、別のアカウントになり、元の投稿やフォローには戻れません。
	</p>
</main>

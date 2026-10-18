<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>Username の設定 | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-sm p-8">
	<h1 class="text-2xl font-bold">ようこそ</h1>
	<p class="mt-2 text-sm text-gray-600">
		公開される名前(Username)を決めてください。メールアドレスは公開しません。あとから変更できます。
	</p>

	<form method="POST" class="mt-6 flex flex-col gap-2">
		<label for="username" class="text-sm font-medium">Username</label>
		<input
			id="username"
			name="username"
			required
			minlength="3"
			maxlength="20"
			pattern="[A-Za-z0-9_]+"
			autocomplete="username"
			value={form?.username ?? ''}
			aria-invalid={form?.error ? 'true' : undefined}
			aria-describedby="username-help"
			class="rounded border border-gray-300 px-3 py-2"
		/>
		<p id="username-help" class="text-xs text-gray-500">半角英数字と _、3〜20文字</p>
		{#if form?.error}
			<p role="alert" class="text-sm text-red-700">{form.error}</p>
		{/if}
		<button class="mt-2 rounded bg-gray-900 px-4 py-2 font-medium text-white">はじめる</button>
	</form>

	<form method="POST" action="/logout" class="mt-6">
		<button class="text-sm text-gray-600 underline">ログアウト</button>
	</form>
</main>

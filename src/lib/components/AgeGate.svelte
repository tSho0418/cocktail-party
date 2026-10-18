<script lang="ts">
	import { page } from '$app/state';
	import { isDeclined, pathWithDeclined } from '#lib/age-gate.js';

	const declined = $derived(isDeclined(page.url));
	const redirectTo = $derived(pathWithDeclined(page.url, false));

	let focusTarget = $state<HTMLElement>();
	// Move focus into the dialog on open and when the message replaces the question.
	$effect(() => {
		void declined;
		focusTarget?.focus();
	});
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- links stay on the current page (query only) -->

<!--
	FR-060/062: rendered on the server on top of the page, never instead of it. The page body is
	made `inert` by the layout, which also traps the keyboard inside this dialog.
-->
<div
	data-age-gate
	class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4"
>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="age-gate-title"
		aria-describedby="age-gate-text"
		class="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
	>
		{#if declined}
			<h2
				id="age-gate-title"
				tabindex="-1"
				bind:this={focusTarget}
				class="text-xl font-bold outline-none"
			>
				ご利用いただけません
			</h2>
			<p id="age-gate-text" class="mt-3 text-sm text-gray-700">
				お酒に関する内容を含むため、20歳未満の方はこのサイトをご利用いただけません。
			</p>
			<a
				href={redirectTo}
				data-sveltekit-replacestate
				class="mt-6 block rounded border border-gray-300 px-4 py-2 text-center font-medium hover:bg-gray-50"
			>
				戻る
			</a>
		{:else}
			<h2 id="age-gate-title" class="text-xl font-bold">年齢の確認</h2>
			<p id="age-gate-text" class="mt-3 text-sm text-gray-700">
				このサイトにはお酒に関する内容が含まれます。あなたは20歳以上ですか?
			</p>
			<form method="POST" action="/age-gate" class="mt-6 flex flex-col gap-3">
				<input type="hidden" name="redirectTo" value={redirectTo} />
				<button
					bind:this={focusTarget}
					class="rounded bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-700"
				>
					はい、20歳以上です
				</button>
				<a
					href={pathWithDeclined(page.url, true)}
					data-sveltekit-replacestate
					class="rounded border border-gray-300 px-4 py-2 text-center font-medium hover:bg-gray-50"
				>
					いいえ
				</a>
			</form>
		{/if}
	</div>
</div>

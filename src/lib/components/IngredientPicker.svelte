<script lang="ts">
	import { createApiClient } from '#lib/api.js';
	import { apiErrorMessage, type IngredientOption } from '#lib/recipe-form.js';

	let {
		onselect,
		excludeIds = []
	}: { onselect: (ingredient: IngredientOption) => void; excludeIds?: string[] } = $props();

	const client = createApiClient();
	const id = $props.id();
	const MAX_NAME_LENGTH = 50;

	let query = $state('');
	let suggestions = $state<IngredientOption[]>([]);
	let searching = $state(false);
	let message = $state<string>();
	let registering = $state(false);
	let searchInput = $state<HTMLInputElement>();
	// Latest request wins; a slow earlier answer must not overwrite a newer one.
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const name = $derived(query.normalize('NFKC').replace(/\s+/g, ' ').trim());
	const hasExactMatch = $derived(
		suggestions.some((s) => s.name.normalize('NFKC').toLowerCase() === name.toLowerCase())
	);

	function oninput() {
		clearTimeout(timer);
		message = undefined;
		if (!name) {
			seq++;
			suggestions = [];
			searching = false;
			return;
		}
		searching = true;
		timer = setTimeout(search, 250);
	}

	// Enter belongs to the search box: it looks up now instead of submitting the surrounding form.
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.isComposing) return;
		e.preventDefault();
		clearTimeout(timer);
		if (name) {
			searching = true;
			void search();
		}
	}

	async function search() {
		const mine = ++seq;
		try {
			const res = await client.api.ingredients.suggest.$get({ query: { name, limit: '8' } });
			if (mine !== seq) return;
			const body = await res.json();
			if ('items' in body) suggestions = body.items;
			else message = apiErrorMessage(body.error);
		} catch {
			if (mine === seq) message = '材料を検索できませんでした。通信状況を確認してください。';
		} finally {
			if (mine === seq) searching = false;
		}
	}

	function pick(ingredient: IngredientOption) {
		// The clicked suggestion is about to vanish; keep focus in the picker rather than letting it fall to <body>.
		searchInput?.focus();
		onselect(ingredient);
		query = '';
		suggestions = [];
		message = undefined;
	}

	// FR-012/014: a Member may add a 0% Ingredient; similar existing ones are already listed above.
	async function register() {
		registering = true;
		message = undefined;
		try {
			const res = await client.api.ingredients.$post({ json: { name, abvPercent: 0 } });
			const body = await res.json();
			if (res.ok && 'id' in body) {
				pick({
					id: body.id,
					name: body.name,
					abvPercent: body.abvPercent,
					isBaseSpirit: body.isBaseSpirit
				});
			} else if ('error' in body && body.error === 'duplicate') {
				suggestions = 'similar' in body && body.similar ? body.similar : suggestions;
				message = '同じ名前の材料がすでにあります。下の一覧から選んでください。';
			} else if ('error' in body && body.error === 'invalid_name') {
				message = `材料名は 1〜${MAX_NAME_LENGTH} 字で入力してください。`;
			} else {
				message = apiErrorMessage('error' in body ? body.error : undefined);
			}
		} catch {
			message = '材料を登録できませんでした。通信状況を確認してください。';
		} finally {
			registering = false;
		}
	}
</script>

<div class="flex flex-col gap-2">
	<label for="{id}-q" class="text-sm font-medium">材料を探す</label>
	<input
		id="{id}-q"
		type="search"
		bind:this={searchInput}
		bind:value={query}
		{oninput}
		{onkeydown}
		autocomplete="off"
		aria-describedby="{id}-help"
		placeholder="例: ジン、ライムジュース"
		class="rounded border border-gray-300 px-3 py-2"
	/>
	<p id="{id}-help" class="text-xs text-gray-500">
		名前を入力すると、登録済みの材料が出ます。酒類は管理者だけが登録できます。
	</p>
	<p role="status" aria-live="polite" class="text-sm text-gray-600">
		{#if searching}
			検索しています…
		{:else if name && suggestions.length === 0 && !message}
			該当する材料はありません。
		{/if}
	</p>

	{#if suggestions.length > 0}
		<ul class="flex flex-col gap-1">
			{#each suggestions as s (s.id)}
				{@const added = excludeIds.includes(s.id)}
				<li>
					<button
						type="button"
						disabled={added}
						onclick={() => pick(s)}
						class="flex w-full items-center justify-between rounded border border-gray-300 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
					>
						<span>{s.name}</span>
						<span class="text-xs text-gray-500">
							{s.abvPercent}%{added ? '・追加済み' : ''}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if name && !searching && !hasExactMatch}
		<button
			type="button"
			disabled={registering}
			onclick={register}
			class="rounded border border-dashed border-gray-400 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
		>
			「{name}」を度数 0% の材料として登録する
		</button>
	{/if}

	{#if message}
		<p role="alert" class="text-sm text-red-700">{message}</p>
	{/if}
</div>

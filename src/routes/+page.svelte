<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const bases = $derived(data.ingredients.filter((i) => i.isBaseSpirit));
	const hasIngredients = $derived(data.form.ingredientIds.length > 0);
	const home = resolve('/');
	const firstHref = $derived(home + data.firstQuery);
	const nextHref = $derived(data.nextQuery === null ? null : home + data.nextQuery);
	const abv = (n: number) => `${n.toFixed(1)}%`;
</script>

<svelte:head>
	<title>Cocktail Party | カクテルのレシピと写真を共有する</title>
	<meta
		name="description"
		content="カクテルのレシピと写真を共有する Web SNS。材料や手持ちのお酒からレシピを探せます。"
	/>
	<!-- Only the bare `/` is the landing page (NFR-007 covers Recipe detail only): search results,
	     later pages and any query string, even an empty form submission, repeat it. -->
	{#if page.url.search !== ''}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- paging links stay on `/` and only change the query -->

<main class="mx-auto max-w-5xl p-4 sm:p-8">
	<h1 class="text-3xl font-bold">Cocktail Party</h1>
	<p class="mt-1 text-gray-600">カクテルのレシピと写真を共有する場所</p>

	<!-- FR-041..045. A plain GET form: works without JavaScript and keeps every search shareable. -->
	<form method="GET" action={resolve('/')} role="search" class="mt-6 space-y-4">
		<div class="flex flex-wrap gap-2">
			<label class="sr-only" for="q">キーワード</label>
			<input
				id="q"
				name="q"
				type="search"
				value={data.form.keyword}
				placeholder="キーワード(タイトル・紹介文・材料・手順)"
				class="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
			/>
			<label class="sr-only" for="sort">並び順</label>
			<select
				id="sort"
				name="sort"
				value={data.form.sort}
				class="rounded border border-gray-300 px-3 py-2"
			>
				<option value="new">新着順</option>
				<option value="like">Like 数順</option>
			</select>
			<button class="rounded bg-gray-900 px-4 py-2 font-medium text-white">検索</button>
		</div>

		<details open={data.filtered} class="rounded border border-gray-200 p-3">
			<summary class="cursor-pointer font-medium">材料・絞り込み</summary>

			<div class="mt-3 space-y-5">
				<fieldset>
					<legend class="text-sm font-medium">材料(選んだものをすべて含む)</legend>
					<div
						class="mt-2 grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded border border-gray-100 p-2 text-sm sm:grid-cols-3 md:grid-cols-4"
					>
						{#each data.ingredients as ing (ing.id)}
							<label class="flex items-center gap-1.5">
								<input
									type="checkbox"
									name="ing"
									value={ing.id}
									checked={data.form.ingredientIds.includes(ing.id)}
								/>
								{ing.name}
							</label>
						{/each}
					</div>
					<label class="mt-2 flex items-center gap-1.5 text-sm">
						<input type="checkbox" name="only" value="1" checked={data.form.onlyThese} />
						選んだ材料だけで作れるレシピに限る(手持ちの材料検索。氷・炭酸水など液体の材料で判定)
					</label>
					{#if data.form.onlyThese && !hasIngredients}
						<p class="mt-1 text-xs text-amber-700">材料を1つ以上選ぶと有効になります。</p>
					{/if}
				</fieldset>

				<fieldset>
					<legend class="text-sm font-medium">ベース(どれかに一致)</legend>
					<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
						{#each bases as base (base.id)}
							<label class="flex items-center gap-1.5">
								<input
									type="checkbox"
									name="base"
									value={base.id}
									checked={data.form.baseIds.includes(base.id)}
								/>
								{base.name}
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
					<legend class="mb-2 text-sm font-medium">度数(%)</legend>
					<label class="flex items-center gap-1.5">
						<span class="sr-only">度数の下限</span>
						<input
							name="abvMin"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							value={data.form.abvMin}
							class="w-24 rounded border border-gray-300 px-2 py-1"
						/>
					</label>
					〜
					<label class="flex items-center gap-1.5">
						<span class="sr-only">度数の上限</span>
						<input
							name="abvMax"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							value={data.form.abvMax}
							class="w-24 rounded border border-gray-300 px-2 py-1"
						/>
					</label>
					<label class="flex items-center gap-1.5">
						<input type="checkbox" name="na" value="1" checked={data.form.nonAlcoholic} />
						ノンアルコールのみ
					</label>
				</fieldset>
			</div>
		</details>

		{#if data.filtered}
			<a href={resolve('/')} class="inline-block text-sm text-gray-600 underline">条件をクリア</a>
		{/if}
	</form>

	<h2 class="sr-only">レシピ一覧</h2>
	{#if data.recipes.length === 0}
		<p class="mt-10 text-center text-gray-600">
			{data.filtered ? '条件に合うレシピはありません。' : 'まだレシピがありません。'}
		</p>
	{:else}
		<ul class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.recipes as recipe, i (recipe.id)}
				<li class="overflow-hidden rounded border border-gray-200">
					<a href={resolve('/recipes/[id]', { id: recipe.id })} class="block hover:bg-gray-50">
						{#if recipe.photoUrl}
							<img
								src={recipe.photoUrl}
								alt="{recipe.title}の写真"
								width="480"
								height="480"
								loading={i < 4 ? 'eager' : 'lazy'}
								class="aspect-square w-full object-cover"
							/>
						{:else}
							<div
								class="flex aspect-square w-full items-center justify-center bg-gray-100 text-sm text-gray-500"
							>
								写真なし
							</div>
						{/if}
						<div class="space-y-1 p-2 text-sm">
							<h3 class="font-bold">{recipe.title}</h3>
							<p class="text-gray-600">
								{#if recipe.nonAlcoholic}ノンアルコール{:else}度数 約{abv(
										recipe.effectiveAbv
									)}{#if recipe.isOverride}<span class="text-xs">(修正値)</span>{/if}{/if}
							</p>
							{#if recipe.bases.length > 0}
								<p class="text-gray-600">{recipe.bases.map((b) => b.name).join('・')}</p>
							{/if}
							<p class="text-xs text-gray-500">
								{recipe.ownerUsername ?? ''} Like {recipe.likeCount}
							</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.hasCursor || data.nextQuery}
		<nav aria-label="ページ送り" class="mt-8 flex items-center justify-between text-sm">
			{#if data.hasCursor}
				<a href={firstHref} class="underline">最初のページへ</a>
			{:else}
				<span></span>
			{/if}
			{#if data.nextQuery}
				<a
					href={nextHref}
					rel="next"
					class="rounded border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50"
					>次のページ</a
				>
			{/if}
		</nav>
	{/if}
</main>

<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { REPORT_REASON_LABELS } from '#lib/report-messages.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const recipe = $derived(data.recipe);

	const abv = (n: number) => `${n.toFixed(1)}%`;
	// Fixed zone so the server-rendered and hydrated text agree.
	const date = (d: Date | string) =>
		new Date(d).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

	const TITLE_SUFFIX = ' | Cocktail Party';
	const summary = $derived(
		recipe.description.trim() ||
			`${recipe.title}のレシピ。材料: ${recipe.ingredients.map((i) => i.name).join('、')}`
	);
</script>

<svelte:head>
	<title>{recipe.title}{TITLE_SUFFIX}</title>
	<meta name="description" content={summary} />
	<!-- FR-080: the title and Main Photo are what a pasted link shows. -->
	<meta property="og:type" content="article" />
	<meta property="og:site_name" content="Cocktail Party" />
	<meta property="og:locale" content="ja_JP" />
	<meta property="og:title" content={recipe.title} />
	<meta property="og:description" content={summary} />
	<meta property="og:url" content={page.url.origin + page.url.pathname} />
	<meta name="twitter:card" content={data.mainPhotoUrl ? 'summary_large_image' : 'summary'} />
	{#if data.mainPhotoUrl}
		<meta property="og:image" content={data.mainPhotoUrl} />
		<meta property="og:image:alt" content="{recipe.title}の写真" />
	{/if}
</svelte:head>

<main class="mx-auto max-w-3xl p-4 sm:p-8">
	<a href={resolve('/')} class="text-sm text-gray-600 underline">← レシピ一覧</a>

	<article class="mt-4">
		<h1 class="text-3xl font-bold">{recipe.title}</h1>
		<p class="mt-1 text-sm text-gray-600">
			{#if recipe.owner.username}{recipe.owner.username} ・
			{/if}
			<time datetime={new Date(recipe.createdAt).toISOString()}>{date(recipe.createdAt)}</time>
			・ Like {recipe.likeCount}
		</p>

		{#if data.mainPhotoUrl}
			<img
				src={data.mainPhotoUrl}
				alt="{recipe.title}の写真"
				class="mt-4 max-h-[36rem] w-full rounded bg-gray-100 object-contain"
			/>
		{/if}

		{#if recipe.description}
			<p class="mt-4 whitespace-pre-wrap">{recipe.description}</p>
		{/if}

		<section class="mt-6" aria-labelledby="abv-heading">
			<h2 id="abv-heading" class="text-lg font-bold">度数</h2>
			{#if recipe.isNonAlcoholic}
				<p class="mt-1">ノンアルコール(0%)</p>
			{:else}
				<p class="mt-1">
					約{abv(recipe.effectiveAbv)}
					<span class="text-sm text-gray-600">(目安。氷の溶けは考慮していません)</span>
				</p>
				{#if recipe.isOverride}
					<p class="text-sm text-gray-600">
						投稿者による修正値です(材料からの自動計算は約{abv(recipe.autoAbv)})。
					</p>
				{/if}
			{/if}
			{#if recipe.bases.length > 0}
				<p class="mt-1 text-sm">ベース: {recipe.bases.map((b) => b.name).join('・')}</p>
			{/if}
		</section>

		<section class="mt-6" aria-labelledby="ingredients-heading">
			<h2 id="ingredients-heading" class="text-lg font-bold">材料</h2>
			<p class="text-sm text-gray-600">1杯分。数字は混ぜる量の割合です(単位はありません)。</p>
			<ul class="mt-2 divide-y divide-gray-100 rounded border border-gray-200">
				{#each recipe.ingredients as ing (ing.id)}
					<li class="flex justify-between px-3 py-2">
						<span>{ing.name}</span>
						<span class="tabular-nums">{ing.mixRatio}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="mt-6" aria-labelledby="steps-heading">
			<h2 id="steps-heading" class="text-lg font-bold">作り方</h2>
			<ol class="mt-2 list-decimal space-y-2 pl-6">
				{#each recipe.steps as step, i (i)}
					<li class="whitespace-pre-wrap">{step}</li>
				{/each}
			</ol>
		</section>

		{#if data.extraPhotoUrls.length > 0}
			<section class="mt-6" aria-labelledby="photos-heading">
				<h2 id="photos-heading" class="text-lg font-bold">写真</h2>
				<ul class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
					{#each data.extraPhotoUrls as url, i (i)}
						{#if url}
							<li>
								<img
									src={url}
									alt="{recipe.title}の写真({i + 2}枚目)"
									loading="lazy"
									class="aspect-square w-full rounded bg-gray-100 object-cover"
								/>
							</li>
						{/if}
					{/each}
				</ul>
			</section>
		{/if}
	</article>

	{#if data.canReport}
		<section class="mt-10 border-t border-gray-200 pt-4" aria-labelledby="report-heading">
			{#if form?.reported}
				<!-- The form this replaces held focus; SvelteKit focuses [autofocus] after a successful action instead of dropping focus to the top of the page (NFR-005). -->
				<!-- svelte-ignore a11y_autofocus -->
				<p role="status" tabindex="-1" autofocus class="text-sm text-gray-700">
					通報を受け付けました。ありがとうございます。
				</p>
			{:else}
				<details>
					<summary id="report-heading" class="cursor-pointer text-sm text-gray-600 underline">
						このレシピを通報する
					</summary>
					<form method="POST" action="?/report" use:enhance class="mt-3 flex flex-col gap-3">
						<fieldset class="flex flex-col gap-1">
							<legend class="text-sm font-medium">理由</legend>
							{#each Object.entries(REPORT_REASON_LABELS) as [value, label] (value)}
								<label class="text-sm">
									<input type="radio" name="reason" {value} required />
									{label}
								</label>
							{/each}
						</fieldset>
						<label class="flex flex-col gap-1 text-sm font-medium">
							補足(任意・200字まで)
							<textarea
								name="detail"
								maxlength="200"
								rows="3"
								class="rounded border border-gray-300 px-3 py-2 font-normal"></textarea>
						</label>
						{#if form?.reportError}
							<p role="alert" class="text-sm text-red-700">{form.reportError}</p>
						{/if}
						<button class="self-start rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white">
							通報する
						</button>
					</form>
				</details>
			{/if}
		</section>
	{/if}
</main>

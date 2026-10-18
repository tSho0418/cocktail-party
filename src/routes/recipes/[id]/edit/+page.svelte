<script lang="ts">
	import RecipeForm from '#lib/components/RecipeForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>レシピを編集する | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-2xl p-4 sm:p-8">
	<h1 class="mb-6 text-2xl font-bold">レシピを編集する</h1>
	{#key data.recipeId}
		<RecipeForm recipeId={data.recipeId} initial={data.initial} />
	{/key}
</main>

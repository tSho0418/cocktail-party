<script lang="ts">
	// Harness for e2e/recipe-form.e2e.ts: the picker inside a <form>, counting submits.
	import IngredientPicker from '#lib/components/IngredientPicker.svelte';

	let submits = $state(0);
</script>

<main class="p-8">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			submits++;
		}}
	>
		<IngredientPicker onselect={() => {}} />
		<button>送信</button>
	</form>
	<output data-submits={submits}>{submits}</output>
</main>

<script lang="ts">
	// Harness for e2e/photo.e2e.ts: shows what PhotoPicker emits. Uploads nothing.
	import PhotoPicker from '#lib/components/PhotoPicker.svelte';

	let picked = $state<{ url: string; type: string; size: number }>();
</script>

<main class="p-8">
	<PhotoPicker
		onselect={(blob) =>
			(picked = { url: URL.createObjectURL(blob), type: blob.type, size: blob.size })}
	/>
	{#if picked}
		<output data-type={picked.type} data-size={picked.size}>{picked.type} {picked.size} B</output>
		<img src={picked.url} alt="選んだ写真" class="max-w-xs" />
	{/if}
</main>

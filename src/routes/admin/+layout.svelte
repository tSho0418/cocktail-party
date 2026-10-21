<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<!-- NFR-007: the administrator screen is never indexed. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{@render children()}

<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import AgeGate from '#lib/components/AgeGate.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- FR-062: the page is always rendered; while the gate is open it is only covered and inert. -->
<div style="display: contents" inert={data.ageGateOpen}>
	{@render children()}
</div>

{#if data.ageGateOpen}
	<AgeGate />
{/if}

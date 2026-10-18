<script lang="ts">
	import { ACCEPT, downsizeImage, type DownsizeError } from '#lib/client/downsize-image.js';

	let { label = '写真を選ぶ', onselect }: { label?: string; onselect: (blob: Blob) => void } =
		$props();

	const MESSAGES: Record<DownsizeError, string> = {
		unsupported_format: 'JPEG、PNG、WebP の画像を選んでください。',
		too_large: '10MB 以下の画像を選んでください。',
		undecodable: 'この画像は読み込めませんでした。別の画像を選んでください。',
		cannot_shrink: '画像を十分に小さくできませんでした。別の画像を選んでください。'
	};

	const id = $props.id();
	let error = $state<string>();
	let busy = $state(false);

	async function onchange(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		error = undefined;
		if (!file) return;
		busy = true;
		const result = await downsizeImage(file);
		busy = false;
		if (result.ok) onselect(result.blob);
		else error = MESSAGES[result.error];
	}
</script>

<label for={id}>{label}</label>
<input
	{id}
	type="file"
	accept={ACCEPT.join(',')}
	disabled={busy}
	aria-describedby={error ? `${id}-error` : undefined}
	{onchange}
/>
{#if error}
	<p id="{id}-error" role="alert" class="text-red-700">{error}</p>
{/if}

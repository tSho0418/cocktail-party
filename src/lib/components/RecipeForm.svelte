<script lang="ts">
	import { goto } from '$app/navigation';
	import { createApiClient } from '#lib/api.js';
	import IngredientPicker from '#lib/components/IngredientPicker.svelte';
	import PhotoPicker from '#lib/components/PhotoPicker.svelte';
	import {
		MAX_DESCRIPTION,
		MAX_EXTRA_PHOTOS,
		MAX_INGREDIENTS,
		MAX_STEPS,
		MAX_STEP_LENGTH,
		MAX_TITLE,
		apiErrorMessage,
		hasErrors,
		previewAlcohol,
		toPayload,
		validateForm,
		type FormValues,
		type IngredientOption,
		type PhotoRef
	} from '#lib/recipe-form.js';

	/** `recipeId` set = edit that Recipe (PUT); unset = publish a new one (POST). */
	let { initial, recipeId }: { initial?: FormValues; recipeId?: string } = $props();

	const client = createApiClient();
	let nextRowId = 1;
	// The form owns its state from here on; callers re-create it (`{#key}`) to load other values.
	// svelte-ignore state_referenced_locally
	const startValues: FormValues = initial ?? {
		title: '',
		description: '',
		mainPhoto: null,
		extraPhotos: [],
		ingredients: [],
		steps: [''],
		abvOverride: ''
	};
	nextRowId += startValues.ingredients.reduce((max, r) => Math.max(max, r.rowId), 0);

	let values = $state<FormValues>(startValues);
	let submitted = $state(false);
	let submitting = $state(false);
	let formError = $state<string>();
	let uploads = $state(0);
	let uploadError = $state<string>();

	const errors = $derived(validateForm(values));
	const preview = $derived(previewAlcohol(values.ingredients, values.abvOverride));

	// FR-024: without alcohol the Alcohol Content is fixed at 0%; a leftover override is dropped once no
	// chosen Ingredient has alcohol (whatever the Mix Ratios say).
	$effect(() => {
		if (values.ingredients.length > 0 && !preview.hasAlcohol && values.abvOverride !== '')
			values.abvOverride = '';
	});

	const fmt = (n: number) => `${n.toFixed(1)}%`;

	// FR-030: PhotoPicker shrinks; the server re-encodes (FR-031). Keys of the stored pair come back.
	async function upload(blob: Blob): Promise<PhotoRef | null> {
		uploads++;
		uploadError = undefined;
		try {
			const res = await fetch('/api/photos?kind=recipe', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: blob
			});
			const body = await res.json().catch(() => null);
			if (!res.ok || !body?.keys?.list) {
				uploadError = apiErrorMessage(
					body?.error,
					'写真をアップロードできませんでした。時間をおいてもう一度お試しください。'
				);
				return null;
			}
			return { key: body.keys.list, url: URL.createObjectURL(blob) };
		} catch {
			uploadError = '写真をアップロードできませんでした。通信状況を確認してください。';
			return null;
		} finally {
			uploads--;
		}
	}

	async function setMain(blob: Blob) {
		const photo = await upload(blob);
		if (photo) values.mainPhoto = photo;
	}

	async function addExtra(blob: Blob) {
		const photo = await upload(blob);
		if (photo && values.extraPhotos.length < MAX_EXTRA_PHOTOS) values.extraPhotos.push(photo);
	}

	function addIngredient(ingredient: IngredientOption) {
		if (values.ingredients.length >= MAX_INGREDIENTS) return;
		values.ingredients.push({ rowId: nextRowId++, ingredient, mixRatio: '' });
	}

	function move<T>(list: T[], from: number, to: number) {
		if (to < 0 || to >= list.length) return;
		list.splice(to, 0, ...list.splice(from, 1));
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		submitted = true;
		formError = undefined;
		if (hasErrors(errors) || uploads > 0 || submitting) return;
		submitting = true;
		let savedId: string | undefined;
		try {
			const json = toPayload(values);
			const res = recipeId
				? await client.api.recipes[':id'].$put({ param: { id: recipeId }, json })
				: await client.api.recipes.$post({ json });
			const body = await res.json();
			if (res.ok && 'id' in body) savedId = body.id;
			else formError = apiErrorMessage('error' in body ? body.error : undefined);
		} catch {
			formError = '保存できませんでした。通信状況を確認してください。';
		} finally {
			submitting = false;
		}
		// The detail page (/recipes/[id]) is a separate route, so `resolve()` has no typed route for it here.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (savedId) await goto(`/recipes/${savedId}`);
	}

	const input = 'rounded border border-gray-300 px-3 py-2';
	const smallButton =
		'rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-40';
</script>

<form onsubmit={submit} novalidate class="flex flex-col gap-8">
	<section class="flex flex-col gap-2">
		<label for="title" class="text-lg font-semibold">タイトル</label>
		<input
			id="title"
			bind:value={values.title}
			maxlength={MAX_TITLE * 2}
			required
			aria-invalid={submitted && errors.title ? 'true' : undefined}
			aria-describedby={submitted && errors.title ? 'title-error' : undefined}
			class={input}
		/>
		<p class="text-xs text-gray-500">{[...values.title.trim()].length} / {MAX_TITLE} 字</p>
		{#if submitted && errors.title}
			<p id="title-error" class="text-sm text-red-700">{errors.title}</p>
		{/if}

		<label for="description" class="mt-2 text-lg font-semibold">紹介文(任意)</label>
		<textarea
			id="description"
			bind:value={values.description}
			rows="3"
			aria-describedby={submitted && errors.description ? 'description-error' : undefined}
			class={input}></textarea>
		<p class="text-xs text-gray-500">
			{[...values.description.trim()].length} / {MAX_DESCRIPTION} 字
		</p>
		{#if submitted && errors.description}
			<p id="description-error" class="text-sm text-red-700">{errors.description}</p>
		{/if}
	</section>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-lg font-semibold">写真</legend>
		<p class="text-xs text-gray-500">
			JPEG・PNG・WebP、1枚10MBまで。位置情報(EXIF)は保存時に取り除かれます。
		</p>

		<div class="flex flex-col gap-2">
			<p class="text-sm font-medium">完成写真(メイン・必須)</p>
			{#if values.mainPhoto?.url}
				<img
					src={values.mainPhoto.url}
					alt="完成写真のプレビュー"
					class="h-40 w-40 rounded object-cover"
				/>
			{:else if values.mainPhoto}
				<p class="text-sm text-gray-600">写真は選択済みです(プレビューは表示できません)。</p>
			{/if}
			<PhotoPicker
				label={values.mainPhoto ? '完成写真を変更する' : '完成写真を選ぶ'}
				onselect={setMain}
			/>
			{#if submitted && errors.mainPhoto}
				<p role="alert" class="text-sm text-red-700">{errors.mainPhoto}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-2">
			<p class="text-sm font-medium">追加の写真(任意・{MAX_EXTRA_PHOTOS}枚まで)</p>
			<ul class="flex flex-wrap gap-3">
				{#each values.extraPhotos as photo, i (photo.key)}
					<li class="flex flex-col items-start gap-1">
						{#if photo.url}
							<img
								src={photo.url}
								alt="追加の写真 {i + 1}"
								class="h-24 w-24 rounded object-cover"
							/>
						{:else}
							<span class="text-sm text-gray-600">追加の写真 {i + 1}</span>
						{/if}
						<button
							type="button"
							class={smallButton}
							onclick={() => values.extraPhotos.splice(i, 1)}
							aria-label="追加の写真 {i + 1} を削除"
						>
							削除
						</button>
					</li>
				{/each}
			</ul>
			{#if values.extraPhotos.length < MAX_EXTRA_PHOTOS}
				<PhotoPicker label="写真を追加する" onselect={addExtra} />
			{/if}
		</div>
		<p role="status" aria-live="polite" class="text-sm text-gray-600">
			{uploads > 0 ? 'アップロードしています…' : ''}
		</p>
		{#if uploadError}
			<p role="alert" class="text-sm text-red-700">{uploadError}</p>
		{/if}
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-lg font-semibold"
			>材料と割合(1杯分・液体のみ、最大{MAX_INGREDIENTS}個)</legend
		>
		<p class="text-xs text-gray-500">
			割合は単位のない相対値です(0.1〜99.9、小数点以下1桁まで)。ミントの葉やビターズなど液量で表せないものは、手順に書いてください。
		</p>
		{#if values.ingredients.length > 0}
			<ul class="flex flex-col gap-2">
				{#each values.ingredients as row, i (row.rowId)}
					{@const rowError = submitted ? errors.rows[row.rowId] : undefined}
					<li class="flex flex-col gap-1 rounded border border-gray-200 p-3">
						<div class="flex flex-wrap items-center gap-2">
							<span class="min-w-0 flex-1 font-medium">
								{row.ingredient.name}
								<span class="text-xs font-normal text-gray-500">{row.ingredient.abvPercent}%</span>
							</span>
							<label for="ratio-{row.rowId}" class="text-sm">割合</label>
							<input
								id="ratio-{row.rowId}"
								bind:value={row.mixRatio}
								inputmode="decimal"
								autocomplete="off"
								aria-invalid={rowError ? 'true' : undefined}
								aria-describedby={rowError ? `ratio-${row.rowId}-error` : undefined}
								class="{input} w-24"
							/>
							<button
								type="button"
								class={smallButton}
								disabled={i === 0}
								onclick={() => move(values.ingredients, i, i - 1)}
								aria-label="{row.ingredient.name} を上へ"
							>
								↑
							</button>
							<button
								type="button"
								class={smallButton}
								disabled={i === values.ingredients.length - 1}
								onclick={() => move(values.ingredients, i, i + 1)}
								aria-label="{row.ingredient.name} を下へ"
							>
								↓
							</button>
							<button
								type="button"
								class={smallButton}
								onclick={() => values.ingredients.splice(i, 1)}
								aria-label="{row.ingredient.name} を削除"
							>
								削除
							</button>
						</div>
						{#if rowError}
							<p id="ratio-{row.rowId}-error" class="text-sm text-red-700">{rowError}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if submitted && errors.ingredients}
			<p role="alert" class="text-sm text-red-700">{errors.ingredients}</p>
		{/if}

		{#if values.ingredients.length < MAX_INGREDIENTS}
			<IngredientPicker
				onselect={addIngredient}
				excludeIds={values.ingredients.map((r) => r.ingredient.id)}
			/>
		{:else}
			<p class="text-sm text-gray-600">材料は {MAX_INGREDIENTS} 個までです。</p>
		{/if}
	</fieldset>

	<section class="flex flex-col gap-2" aria-labelledby="abv-heading">
		<h2 id="abv-heading" class="text-lg font-semibold">度数(Alcohol Content)</h2>
		{#if preview.autoAbv === null}
			<p class="text-sm text-gray-600">材料と割合を入れると、度数の目安を自動で計算します。</p>
		{:else if !preview.hasAlcohol}
			<p data-testid="abv-effective">
				<span class="text-xl font-bold">{fmt(0)}</span>
				<span class="text-sm text-gray-600">
					酒類を含まないため 0% に固定されます(ノンアルコール)。</span
				>
			</p>
		{:else}
			<p data-testid="abv-effective">
				<span class="text-xl font-bold">{fmt(preview.effectiveAbv ?? preview.autoAbv)}</span>
				<span class="text-sm text-gray-600">
					{preview.override.state === 'valid' ? '投稿者による修正値' : '自動計算の目安'}
				</span>
			</p>
			{#if preview.override.state === 'valid'}
				<p class="text-sm text-gray-600" data-testid="abv-auto">
					自動計算の値: {fmt(preview.autoAbv)}(目安・氷の溶けは考慮しません)
				</p>
			{:else}
				<p class="text-xs text-gray-500">氷の溶けは考慮しない目安です。</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<label for="abv-override" class="text-sm">度数を自分で修正する(任意)</label>
				<input
					id="abv-override"
					bind:value={values.abvOverride}
					inputmode="decimal"
					autocomplete="off"
					aria-invalid={errors.abvOverride ? 'true' : undefined}
					aria-describedby="abv-override-help"
					class="{input} w-24"
				/>
				<span aria-hidden="true">%</span>
				{#if values.abvOverride.trim() !== ''}
					<button type="button" class={smallButton} onclick={() => (values.abvOverride = '')}>
						再計算する
					</button>
				{/if}
			</div>
			<p id="abv-override-help" class="text-xs text-gray-500">
				0% を超え、材料の最高度数 {preview.maxIngredientAbv}% 以下。材料を変えても修正値は残ります。
			</p>
			{#if errors.abvOverride}
				<p role="alert" class="text-sm text-red-700">{errors.abvOverride}</p>
			{/if}
		{/if}
	</section>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-lg font-semibold">手順(最大{MAX_STEPS}ステップ)</legend>
		<ol class="flex flex-col gap-3">
			{#each values.steps as step, i (i)}
				{@const stepError = submitted ? errors.stepRows[i] : undefined}
				<li class="flex flex-col gap-1">
					<label for="step-{i}" class="text-sm font-medium">ステップ {i + 1}</label>
					<textarea
						id="step-{i}"
						bind:value={values.steps[i]}
						rows="2"
						aria-invalid={stepError ? 'true' : undefined}
						aria-describedby={stepError ? `step-${i}-error` : undefined}
						class={input}></textarea>
					<div class="flex items-center gap-2">
						<span class="text-xs text-gray-500">
							{[...step.trim()].length} / {MAX_STEP_LENGTH} 字
						</span>
						<button
							type="button"
							class={smallButton}
							disabled={i === 0}
							onclick={() => move(values.steps, i, i - 1)}
							aria-label="ステップ {i + 1} を上へ"
						>
							↑
						</button>
						<button
							type="button"
							class={smallButton}
							disabled={i === values.steps.length - 1}
							onclick={() => move(values.steps, i, i + 1)}
							aria-label="ステップ {i + 1} を下へ"
						>
							↓
						</button>
						<button
							type="button"
							class={smallButton}
							disabled={values.steps.length === 1}
							onclick={() => values.steps.splice(i, 1)}
							aria-label="ステップ {i + 1} を削除"
						>
							削除
						</button>
					</div>
					{#if stepError}
						<p id="step-{i}-error" class="text-sm text-red-700">{stepError}</p>
					{/if}
				</li>
			{/each}
		</ol>
		{#if values.steps.length < MAX_STEPS}
			<button type="button" class="{smallButton} self-start" onclick={() => values.steps.push('')}>
				ステップを追加
			</button>
		{/if}
		{#if submitted && errors.steps}
			<p role="alert" class="text-sm text-red-700">{errors.steps}</p>
		{/if}
	</fieldset>

	{#if formError}
		<p role="alert" class="rounded bg-red-50 p-3 text-sm text-red-700">{formError}</p>
	{/if}
	{#if submitted && hasErrors(errors) && !formError}
		<p role="alert" class="rounded bg-red-50 p-3 text-sm text-red-700">
			入力内容を確認してください。
		</p>
	{/if}

	<button
		disabled={submitting || uploads > 0}
		class="rounded bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-50"
	>
		{recipeId ? '変更を保存する' : '投稿する'}
	</button>
	{#if !recipeId}
		<p class="-mt-6 text-xs text-gray-500">投稿するとすぐに公開されます。</p>
	{/if}
</form>

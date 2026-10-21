<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
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
	// Steps are plain strings, so each gets an id here to keep its DOM node (and focus) when it moves.
	let nextStepKey = 1;
	let stepKeys = $state(startValues.steps.map(() => nextStepKey++));
	let submitted = $state(false);
	// Set once a save succeeds and stays set: the button stays off until the detail page replaces the
	// form, so a second click or Enter cannot publish a duplicate Recipe (FR-001).
	let submitting = $state(false);
	let savedId = $state<string>();
	let formError = $state<string>();
	let uploads = $state(0);
	let uploadError = $state<string>();
	let formErrorEl = $state<HTMLElement>();
	let errorSummaryEl = $state<HTMLElement>();

	const errors = $derived(validateForm(values));
	const preview = $derived(previewAlcohol(values.ingredients, values.abvOverride));

	// FR-024: without alcohol the Alcohol Content is fixed at 0%; a leftover override is dropped once no
	// chosen Ingredient has alcohol (whatever the Mix Ratios say).
	$effect(() => {
		if (values.ingredients.length > 0 && !preview.hasAlcohol && values.abvOverride !== '')
			values.abvOverride = '';
	});

	const fmt = (n: number) => `${n.toFixed(1)}%`;

	// NFR-005: previews are described by the Recipe's title once it is typed.
	const title = $derived(values.title.trim());
	const mainPhotoAlt = $derived(title ? `${title} の完成写真` : '完成写真のプレビュー');
	const extraPhotoAlt = (i: number) => (title ? `${title} の写真 ${i + 1}` : `追加の写真 ${i + 1}`);

	// Messages for the summary a failed submit moves focus to.
	const errorMessages = $derived.by(() => {
		const e = errors;
		const names = new Map(values.ingredients.map((r) => [r.rowId, r.ingredient.name]));
		return [
			e.title,
			e.description,
			e.mainPhoto,
			e.ingredients,
			...Object.entries(e.rows).map(([id, m]) => `${names.get(Number(id))}: ${m}`),
			e.steps,
			...Object.entries(e.stepRows).map(([i, m]) => `ステップ ${Number(i) + 1}: ${m}`),
			e.abvOverride
		].filter((m): m is string => !!m);
	});

	// Blob URLs of chosen previews live until the photo is replaced, removed or the form goes away.
	const revoke = (photo: PhotoRef | null | undefined) => {
		if (photo?.url?.startsWith('blob:')) URL.revokeObjectURL(photo.url);
	};
	$effect(() => () => {
		revoke(values.mainPhoto);
		values.extraPhotos.forEach(revoke);
	});

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
		if (!photo) return;
		revoke(values.mainPhoto);
		values.mainPhoto = photo;
	}

	async function addExtra(blob: Blob) {
		const photo = await upload(blob);
		if (!photo) return;
		if (values.extraPhotos.length < MAX_EXTRA_PHOTOS) values.extraPhotos.push(photo);
		else revoke(photo);
	}

	function removeExtra(i: number) {
		revoke(values.extraPhotos[i]);
		values.extraPhotos.splice(i, 1);
	}

	function addIngredient(ingredient: IngredientOption) {
		if (values.ingredients.length >= MAX_INGREDIENTS) return;
		const rowId = nextRowId++;
		values.ingredients.push({ rowId, ingredient, mixRatio: '' });
		// The suggestion that was clicked disappears with the list; the ratio is what is needed next.
		void tick().then(() => document.getElementById(`ratio-${rowId}`)?.focus());
	}

	const shift = <T,>(list: T[], from: number, to: number) =>
		list.splice(to, 0, ...list.splice(from, 1));

	/** Moves an item; focus follows it, on the same arrow or, at the end of the list, the other one. */
	async function move(kind: 'ingredient' | 'step', i: number, to: number) {
		const length = kind === 'ingredient' ? values.ingredients.length : values.steps.length;
		if (to < 0 || to >= length) return;
		let key: number;
		if (kind === 'ingredient') {
			key = values.ingredients[i].rowId;
			shift(values.ingredients, i, to);
		} else {
			key = stepKeys[i];
			shift(values.steps, i, to);
			shift(stepKeys, i, to);
		}
		const dir = to < i ? 'up' : 'down';
		await tick();
		const button = (d: string) =>
			document.querySelector<HTMLButtonElement>(`[data-move="${kind}-${key}-${d}"]`);
		const same = button(dir);
		(same && !same.disabled ? same : button(dir === 'up' ? 'down' : 'up'))?.focus();
	}

	function addStep() {
		values.steps.push('');
		stepKeys.push(nextStepKey++);
	}

	function removeStep(i: number) {
		values.steps.splice(i, 1);
		stepKeys.splice(i, 1);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		submitted = true;
		formError = undefined;
		if (submitting) return;
		if (hasErrors(errors)) {
			await tick();
			errorSummaryEl?.focus();
			return;
		}
		if (uploads > 0) return;
		submitting = true;
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
		}
		if (!savedId) {
			// Only a failed save frees the button; a saved one stays locked while navigating.
			submitting = false;
			await tick();
			formErrorEl?.focus();
			return;
		}
		await goto(resolve('/recipes/[id]', { id: savedId }));
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
			aria-invalid={submitted && errors.description ? 'true' : undefined}
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
				<img src={values.mainPhoto.url} alt={mainPhotoAlt} class="h-40 w-40 rounded object-cover" />
			{:else if values.mainPhoto}
				<p class="text-sm text-gray-600">写真は選択済みです(プレビューは表示できません)。</p>
			{/if}
			<PhotoPicker
				label={values.mainPhoto ? '完成写真を変更する' : '完成写真を選ぶ'}
				disabled={uploads > 0}
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
							<img src={photo.url} alt={extraPhotoAlt(i)} class="h-24 w-24 rounded object-cover" />
						{:else}
							<span class="text-sm text-gray-600">追加の写真 {i + 1}</span>
						{/if}
						<button
							type="button"
							class={smallButton}
							onclick={() => removeExtra(i)}
							aria-label="追加の写真 {i + 1} を削除"
						>
							削除
						</button>
					</li>
				{/each}
			</ul>
			{#if values.extraPhotos.length < MAX_EXTRA_PHOTOS}
				<PhotoPicker label="写真を追加する" disabled={uploads > 0} onselect={addExtra} />
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
								data-move="ingredient-{row.rowId}-up"
								onclick={() => move('ingredient', i, i - 1)}
								aria-label="{row.ingredient.name} を上へ"
							>
								↑
							</button>
							<button
								type="button"
								class={smallButton}
								disabled={i === values.ingredients.length - 1}
								data-move="ingredient-{row.rowId}-down"
								onclick={() => move('ingredient', i, i + 1)}
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
		{#if !preview.hasAlcohol && preview.autoAbv !== null}
			<p data-testid="abv-effective">
				<span class="text-xl font-bold">{fmt(0)}</span>
				<span class="text-sm text-gray-600">
					酒類を含まないため 0% に固定されます(ノンアルコール)。</span
				>
			</p>
		{:else if preview.effectiveAbv === null}
			<!-- Also while an Ingredient with alcohol still has no valid Mix Ratio: a partial sum would read too low. -->
			<p class="text-sm text-gray-600">材料と割合を入れると、度数の目安を自動で計算します。</p>
		{:else}
			<p data-testid="abv-effective">
				<span class="text-xl font-bold">{fmt(preview.effectiveAbv)}</span>
				<span class="text-sm text-gray-600">
					{preview.override.state === 'valid' ? '投稿者による修正値' : '自動計算の目安'}
				</span>
			</p>
			{#if preview.override.state === 'valid' && preview.autoAbv !== null}
				<p class="text-sm text-gray-600" data-testid="abv-auto">
					自動計算の値: {fmt(preview.autoAbv)}(目安・氷の溶けは考慮しません)
				</p>
			{:else}
				<p class="text-xs text-gray-500">氷の溶けは考慮しない目安です。</p>
			{/if}
		{/if}
		{#if preview.hasAlcohol}
			<div class="flex flex-wrap items-center gap-2">
				<label for="abv-override" class="text-sm">度数を自分で修正する(任意)</label>
				<input
					id="abv-override"
					bind:value={values.abvOverride}
					inputmode="decimal"
					autocomplete="off"
					aria-invalid={errors.abvOverride ? 'true' : undefined}
					aria-describedby={errors.abvOverride
						? 'abv-override-error abv-override-help'
						: 'abv-override-help'}
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
				<p id="abv-override-error" role="alert" class="text-sm text-red-700">
					{errors.abvOverride}
				</p>
			{/if}
		{/if}
	</section>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-lg font-semibold">手順(最大{MAX_STEPS}ステップ)</legend>
		<ol class="flex flex-col gap-3">
			{#each values.steps as step, i (stepKeys[i])}
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
							data-move="step-{stepKeys[i]}-up"
							onclick={() => move('step', i, i - 1)}
							aria-label="ステップ {i + 1} を上へ"
						>
							↑
						</button>
						<button
							type="button"
							class={smallButton}
							disabled={i === values.steps.length - 1}
							data-move="step-{stepKeys[i]}-down"
							onclick={() => move('step', i, i + 1)}
							aria-label="ステップ {i + 1} を下へ"
						>
							↓
						</button>
						<button
							type="button"
							class={smallButton}
							disabled={values.steps.length === 1}
							onclick={() => removeStep(i)}
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
			<button type="button" class="{smallButton} self-start" onclick={addStep}>
				ステップを追加
			</button>
		{/if}
		{#if submitted && errors.steps}
			<p role="alert" class="text-sm text-red-700">{errors.steps}</p>
		{/if}
	</fieldset>

	{#if formError}
		<p
			bind:this={formErrorEl}
			tabindex="-1"
			role="alert"
			class="rounded bg-red-50 p-3 text-sm text-red-700"
		>
			{formError}
		</p>
	{/if}
	{#if submitted && hasErrors(errors) && !formError}
		<div
			bind:this={errorSummaryEl}
			tabindex="-1"
			role="alert"
			class="rounded bg-red-50 p-3 text-sm text-red-700"
		>
			<p>入力内容を確認してください。</p>
			<ul class="mt-1 list-disc pl-5">
				{#each errorMessages as message (message)}
					<li>{message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<button
		disabled={submitting || uploads > 0}
		class="rounded bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-50"
	>
		{recipeId ? '変更を保存する' : '投稿する'}
	</button>
	{#if savedId}
		<p role="status" class="text-sm text-gray-600">
			保存しました。移動しています…
			<a href={resolve('/recipes/[id]', { id: savedId })} class="underline"
				>移動しない場合はこちら</a
			>
		</p>
	{/if}
	{#if !recipeId}
		<p class="-mt-6 text-xs text-gray-500">投稿するとすぐに公開されます。</p>
	{/if}
</form>

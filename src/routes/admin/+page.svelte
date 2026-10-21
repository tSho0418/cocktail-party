<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS } from '#lib/report-messages.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const date = (d: Date | string) =>
		new Date(d).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
	const input = 'rounded border border-gray-300 px-2 py-1 text-sm';
	const button = 'rounded bg-gray-900 px-3 py-1 text-sm font-medium text-white';
</script>

<svelte:head><title>管理画面 | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-4xl p-4 sm:p-8">
	<h1 class="text-2xl font-bold">管理画面</h1>
	{#if form?.error}
		<p role="alert" class="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{form.error}</p>
	{/if}

	<section class="mt-8" aria-labelledby="reports-heading">
		<h2 id="reports-heading" class="text-lg font-bold">通報(Report)</h2>
		{#if data.reports.length === 0}
			<p class="mt-2 text-sm text-gray-600">通報はありません。</p>
		{/if}
		<ul class="mt-2 space-y-3">
			{#each data.reports as r (r.id)}
				<li class="rounded border border-gray-200 p-3 text-sm">
					<p class="font-medium">
						{REPORT_STATUS_LABELS[r.status]} ・ {REPORT_REASON_LABELS[r.reason]}
						<span class="font-normal text-gray-600">・ {date(r.createdAt)}</span>
					</p>
					<p class="mt-1">
						対象:
						{#if r.targetState === 'live' && r.recipeId}
							<a href={resolve('/recipes/[id]', { id: r.recipeId })} class="underline"
								>{r.recipeTitle}</a
							>
						{:else if r.targetState === 'member_withdrawn'}
							退会済み
						{:else}
							削除済みのレシピ
						{/if}
						{#if r.targetState !== 'member_withdrawn'}
							(投稿者: {r.reportedUsername ?? '不明'}{r.reportedSuspended ? '・停止中' : ''})
						{/if}
					</p>
					<p>送信者: {r.reporterUsername ?? '退会済み'}</p>
					{#if r.detail}<p class="mt-1 whitespace-pre-wrap">{r.detail}</p>{/if}
					<div class="mt-2 flex flex-wrap items-center gap-2">
						<form method="POST" action="?/setStatus" use:enhance class="flex gap-1">
							<input type="hidden" name="id" value={r.id} />
							<select name="status" aria-label="状態" class={input}>
								{#each Object.entries(REPORT_STATUS_LABELS) as [value, label] (value)}
									<option {value} selected={value === r.status}>{label}</option>
								{/each}
							</select>
							<button class={button}>状態を変更</button>
						</form>
						{#if r.targetState === 'live' && r.recipeId}
							<form method="POST" action="?/deleteRecipe" use:enhance>
								<input type="hidden" name="recipeId" value={r.recipeId} />
								<button class="rounded bg-red-700 px-3 py-1 text-sm font-medium text-white"
									>レシピを削除</button
								>
							</form>
						{/if}
						{#if r.reportedUsername && r.targetState !== 'member_withdrawn'}
							<form
								method="POST"
								action={r.reportedSuspended ? '?/unsuspend' : '?/suspend'}
								use:enhance
							>
								<input type="hidden" name="username" value={r.reportedUsername} />
								<button class={button}>{r.reportedSuspended ? '停止を解除' : '投稿者を停止'}</button
								>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<section class="mt-10" aria-labelledby="suspension-heading">
		<h2 id="suspension-heading" class="text-lg font-bold">メンバーの停止(Suspension)</h2>
		<form method="POST" action="?/suspend" use:enhance class="mt-2 flex gap-2">
			<input name="username" required placeholder="Username" aria-label="Username" class={input} />
			<button class={button}>停止する</button>
		</form>
		<ul class="mt-3 space-y-1 text-sm">
			{#each data.suspended as m (m.id)}
				<li class="flex items-center gap-3">
					<span>{m.username}</span>
					<span class="text-gray-600">{date(m.suspendedAt)}から</span>
					<form method="POST" action="?/unsuspend" use:enhance>
						<input type="hidden" name="username" value={m.username} />
						<button class="text-sm underline">解除</button>
					</form>
				</li>
			{:else}
				<li class="text-gray-600">停止中のメンバーはいません。</li>
			{/each}
		</ul>
	</section>

	<section class="mt-10" aria-labelledby="ingredients-heading">
		<h2 id="ingredients-heading" class="text-lg font-bold">酒類の材料(Ingredient)</h2>
		<form method="POST" action="?/createIngredient" use:enhance class="mt-2 flex flex-wrap gap-2">
			<input
				name="name"
				required
				maxlength="50"
				placeholder="名前"
				aria-label="名前"
				class={input}
			/>
			<input
				name="abvPercent"
				required
				type="number"
				min="0.1"
				max="100"
				step="0.1"
				placeholder="度数(%)"
				aria-label="度数(%)"
				class="{input} w-28"
			/>
			<label class="flex items-center gap-1 text-sm">
				<input type="checkbox" name="isBaseSpirit" />ベース
			</label>
			<button class={button}>登録</button>
		</form>
		<p class="mt-1 text-xs text-gray-600">
			度数を変えると、その材料を使うすべてのレシピの度数を再計算します。範囲を外れた修正値は破棄されます。
		</p>
		<ul class="mt-3 divide-y divide-gray-100 text-sm">
			{#each data.ingredients as ing (ing.id)}
				<li class="flex items-center gap-3 py-1">
					<span class="flex-1">{ing.name}{ing.isBaseSpirit ? '(ベース)' : ''}</span>
					<form method="POST" action="?/updateAbv" use:enhance class="flex items-center gap-1">
						<input type="hidden" name="id" value={ing.id} />
						<input
							name="abvPercent"
							type="number"
							min="0"
							max="100"
							step="0.1"
							required
							value={ing.abvPercent}
							aria-label="{ing.name}の度数(%)"
							class="{input} w-24"
						/>
						<button class={button}>変更</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
</main>

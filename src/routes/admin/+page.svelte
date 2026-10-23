<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS } from '#lib/report-messages.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const date = (d: Date | string) =>
		new Date(d).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
	// Actions post to this page's own URL, so they must carry the filter or the list snaps back to 未対応.
	const act = (name: string) =>
		`?/${name}${data.status === 'open' ? '' : `&status=${data.status}`}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;
	const input = 'rounded border border-gray-300 px-2 py-1 text-sm';
	const button = 'rounded bg-gray-900 px-3 py-1 text-sm font-medium text-white';
</script>

{#snippet ingredientRow(ing: (typeof data.ingredients.zero)[number])}
	<li class="flex flex-wrap items-start gap-x-3 gap-y-1 py-1">
		<span class="min-w-40 flex-1 break-words">{ing.name}{ing.isBaseSpirit ? '(ベース)' : ''}</span>
		<form method="POST" action={act('updateAbv')} use:enhance class="flex items-center gap-1">
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
		{#if ing.abvPercent === 0}
			{#if ing.inUse}
				<span class="w-40 shrink-0 py-1 text-xs text-gray-600">レシピで使用中</span>
			{:else}
				<!-- Same confirmation as the Recipe deletion: opening <details> works without JavaScript. -->
				<details class="w-40 shrink-0">
					<summary class="cursor-pointer text-sm text-red-700 underline">削除する</summary>
					<form
						method="POST"
						action={act('deleteIngredient')}
						use:enhance
						class="mt-1 flex flex-col gap-1"
					>
						<input type="hidden" name="id" value={ing.id} />
						<p class="text-xs">
							「{ing.name}」を削除します。元に戻せません。
						</p>
						<button class="self-start rounded bg-red-700 px-3 py-1 text-sm font-medium text-white"
							>削除を確定する</button
						>
					</form>
				</details>
			{/if}
		{/if}
	</li>
{/snippet}

<svelte:head><title>管理画面 | Cocktail Party</title></svelte:head>

<main class="mx-auto max-w-4xl p-4 sm:p-8">
	<h1 class="text-2xl font-bold">管理画面</h1>
	{#if form?.error}
		<!-- Sticky: the forms run down a long page, and a message at the top would be out of sight. -->
		<p
			role="alert"
			class="sticky top-2 z-10 mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700"
		>
			{form.error}
		</p>
	{/if}

	<section class="mt-8" aria-labelledby="reports-heading">
		<h2 id="reports-heading" class="text-lg font-bold">通報(Report)</h2>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- same page, only the query changes -->
		<nav class="mt-2 flex gap-3 text-sm" aria-label="状態で絞り込む">
			{#each [['open', '未対応'], ['resolved', '対応済み'], ['dismissed', '却下'], ['all', 'すべて']] as [value, label] (value)}
				<a
					href={resolve('/admin') + (value === 'open' ? '' : '?status=' + value)}
					aria-current={data.status === value ? 'page' : undefined}
					class={data.status === value ? 'font-bold underline' : 'text-gray-600 underline'}
					>{label}</a
				>
			{/each}
		</nav>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{#if data.reports.length === 0}
			<p class="mt-2 text-sm text-gray-600">通報はありません。</p>
		{/if}
		<ul class="mt-2 space-y-3">
			{#each data.reports as r (r.id)}
				<li class="rounded border border-gray-200 p-3 text-sm break-words">
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
						<form method="POST" action={act('setStatus')} use:enhance class="flex gap-1">
							<input type="hidden" name="id" value={r.id} />
							<select name="status" aria-label="状態" class={input}>
								{#each Object.entries(REPORT_STATUS_LABELS) as [value, label] (value)}
									<option {value} selected={value === r.status}>{label}</option>
								{/each}
							</select>
							<button class={button}>状態を変更</button>
						</form>
						{#if r.targetState === 'live' && r.recipeId}
							<!-- Same confirmation as the Recipe page: opening <details> works without JavaScript. -->
							<details>
								<summary class="cursor-pointer text-sm text-red-700 underline"
									>レシピを削除する</summary
								>
								<form
									method="POST"
									action={act('deleteRecipe')}
									use:enhance
									class="mt-2 flex flex-col gap-2"
								>
									<input type="hidden" name="recipeId" value={r.recipeId} />
									<p>
										このレシピを削除します。付いているいいねと保存も一緒に消え、元に戻せません。投稿者には通知されません。Report
										は記録として残ります。
									</p>
									<button
										class="self-start rounded bg-red-700 px-3 py-1 text-sm font-medium text-white"
										>削除を確定する</button
									>
								</form>
							</details>
						{/if}
						{#if r.reportedUsername && r.targetState !== 'member_withdrawn'}
							<form
								method="POST"
								action={act(r.reportedSuspended ? 'unsuspend' : 'suspend')}
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
		{#if data.nextCursor}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- same page, only the query changes -->
			<a
				href={resolve('/admin') +
					'?' +
					new URLSearchParams({
						...(data.status === 'open' ? {} : { status: data.status }),
						cursor: data.nextCursor
					})}
				rel="next"
				class="mt-3 inline-block text-sm underline">次へ</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</section>

	<section class="mt-10" aria-labelledby="suspension-heading">
		<h2 id="suspension-heading" class="text-lg font-bold">メンバーの停止(Suspension)</h2>
		<form method="POST" action={act('suspend')} use:enhance class="mt-2 flex gap-2">
			<input name="username" required placeholder="Username" aria-label="Username" class={input} />
			<button class={button}>停止する</button>
		</form>
		<ul class="mt-3 space-y-1 text-sm">
			{#each data.suspended as m (m.id)}
				<li class="flex items-center gap-3">
					<span>{m.username}</span>
					<span class="text-gray-600">{date(m.suspendedAt)}から</span>
					<form method="POST" action={act('unsuspend')} use:enhance>
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
		<h2 id="ingredients-heading" class="text-lg font-bold">材料(Ingredient)</h2>
		<form
			method="POST"
			action={act('createIngredient')}
			use:enhance
			class="mt-2 flex flex-wrap gap-2"
		>
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
			度数を変えると、その材料を使うすべてのレシピの度数を再計算します。範囲を外れた修正値は破棄されます。上のフォームは酒類の登録用です。0%
			の材料はメンバーが登録するもので、どのレシピでも使われていないものだけ削除できます。
		</p>
		<h3 class="mt-4 text-sm font-bold">酒類({data.ingredients.alcoholic.length} 件)</h3>
		<ul class="mt-1 divide-y divide-gray-100 text-sm">
			{#each data.ingredients.alcoholic as ing (ing.id)}
				{@render ingredientRow(ing)}
			{/each}
		</ul>

		<h3 class="mt-6 text-sm font-bold">度数 0% の材料(メンバーが登録)</h3>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- same page, only the query changes -->
		<form method="GET" action={resolve('/admin')} class="mt-1 flex gap-2" role="search">
			{#if data.status !== 'open'}<input type="hidden" name="status" value={data.status} />{/if}
			<input
				type="search"
				name="q"
				value={data.q}
				placeholder="名前で探す"
				aria-label="0% の材料を名前で探す"
				class={input}
			/>
			<button class={button}>探す</button>
		</form>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<p class="mt-1 text-xs text-gray-600">
			{#if data.ingredients.zeroTotal > data.ingredients.zero.length}
				{data.ingredients.zeroTotal} 件中 {data.ingredients.zero.length}
				件を表示しています。名前で絞り込んでください。
			{:else}
				{data.ingredients.zeroTotal} 件
			{/if}
		</p>
		<ul class="mt-1 divide-y divide-gray-100 text-sm">
			{#each data.ingredients.zero as ing (ing.id)}
				{@render ingredientRow(ing)}
			{/each}
		</ul>
	</section>
</main>

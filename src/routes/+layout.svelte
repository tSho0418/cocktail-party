<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import AgeGate from '#lib/components/AgeGate.svelte';
	import { isDeclined } from '#lib/age-gate.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const link = 'rounded px-2 py-1 hover:bg-gray-100';
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- The declined view repeats every page under another URL with only the message (NFR-007). -->
	{#if isDeclined(page.url)}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- /admin, /terms and /privacy are built by other branches (not in the typed route list yet); the saved tab only changes the query -->

<!-- FR-062: the page is always rendered; while the gate is open it is only covered and inert. -->
<div style="display: contents" inert={data.ageGateOpen}>
	<div class="flex min-h-screen flex-col">
		<header class="border-b border-gray-200">
			<nav
				aria-label="メインメニュー"
				class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm"
			>
				<a href={resolve('/')} class="mr-auto py-1 text-base font-bold">Cocktail Party</a>
				{#if !data.member}
					<a href={resolve('/(auth)/login')} class={link}>ログイン</a>
				{:else}
					{#if data.member.username}
						<a href={resolve('/recipes/new')} class={link}>レシピを投稿</a>
						<a
							href={resolve('/members/[username]', { username: data.member.username }) +
								'?tab=saved'}
							class={link}>保存したレシピ</a
						>
						<a
							href={resolve('/members/[username]', { username: data.member.username })}
							class={link}>マイページ</a
						>
					{:else}
						<a href={resolve('/(auth)/welcome')} class={link}>Username を決める</a>
					{/if}
					{#if data.member.isAdministrator}
						<a href="/admin" class={link}>管理</a>
					{/if}
					<a href={resolve('/(auth)/logout')} class={link}>ログアウト</a>
				{/if}
			</nav>
		</header>

		<div class="flex-1">
			{@render children()}
		</div>

		<footer class="border-t border-gray-200">
			<nav
				aria-label="フッター"
				class="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-sm text-gray-600"
			>
				<a href="/terms" class="underline">利用規約</a>
				<a href="/privacy" class="underline">プライバシーポリシー</a>
			</nav>
		</footer>
	</div>
</div>

{#if data.ageGateOpen}
	<AgeGate />
{/if}

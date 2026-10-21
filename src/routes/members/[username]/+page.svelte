<script lang="ts">
	import { resolve } from '$app/paths';
	import FollowButton from '#lib/components/FollowButton.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { profile } = $derived(data);

	const tabs = $derived([
		{ id: 'recipes', label: `レシピ ${profile.recipeCount}` },
		{ id: 'following', label: `フォロー中 ${profile.followingCount}` },
		{ id: 'followers', label: `フォロワー ${profile.followerCount}` },
		...(data.isSelf ? [{ id: 'saved', label: '保存したレシピ' }] : [])
	]);
	const base = $derived(resolve('/members/[username]', { username: profile.username }));
	const empty = $derived(
		{
			recipes: 'まだレシピがありません。',
			following: 'まだ誰もフォローしていません。',
			followers: 'まだフォロワーがいません。',
			saved: '保存したレシピはまだありません。'
		}[data.tab]
	);
</script>

<svelte:head><title>{profile.username} | Cocktail Party</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- tab and paging links only change the query -->
<main class="mx-auto max-w-3xl p-6">
	<header class="flex items-start gap-4">
		{#if profile.iconUrl}
			<img src={profile.iconUrl} alt="" class="size-20 rounded-full object-cover" />
		{:else}
			<div
				aria-hidden="true"
				class="flex size-20 items-center justify-center rounded-full bg-gray-200 text-3xl font-bold text-gray-600"
			>
				{profile.username.slice(0, 1).toUpperCase()}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl font-bold break-words">{profile.username}</h1>
			{#if profile.bio}
				<p class="mt-2 whitespace-pre-wrap text-gray-800">{profile.bio}</p>
			{/if}
			<div class="mt-3 flex flex-wrap items-center gap-3">
				{#if data.isSelf}
					<a
						href={resolve('/members/[username]/edit', { username: profile.username })}
						class="rounded border border-gray-300 px-4 py-1.5 text-sm">プロフィールを編集</a
					>
					<a href={resolve('/(auth)/withdraw')} class="text-sm text-gray-600 underline">退会する</a>
				{:else}
					<FollowButton
						username={profile.username}
						following={profile.isFollowing}
						signedIn={data.signedIn}
					/>
				{/if}
			</div>
		</div>
	</header>

	<nav aria-label="プロフィールの一覧" class="mt-8 flex flex-wrap gap-4 border-b border-gray-200">
		{#each tabs as t (t.id)}
			<a
				href={t.id === 'recipes' ? base : `${base}?tab=${t.id}`}
				aria-current={data.tab === t.id ? 'page' : undefined}
				class="-mb-px border-b-2 px-1 py-2 text-sm {data.tab === t.id
					? 'border-gray-900 font-bold'
					: 'border-transparent text-gray-600'}">{t.label}</a
			>
		{/each}
	</nav>

	<section class="mt-6" aria-label={tabs.find((t) => t.id === data.tab)?.label}>
		{#if data.list.items.length === 0}
			<p class="text-gray-600">{empty}</p>
		{:else if data.list.kind === 'recipes'}
			<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3">
				{#each data.list.items as r (r.id)}
					<li>
						<a href={resolve('/recipes/[id]', { id: r.id })} class="block">
							{#if r.photoUrl}
								<img
									src={r.photoUrl}
									alt=""
									loading="lazy"
									class="aspect-square w-full rounded object-cover"
								/>
							{:else}
								<div class="aspect-square w-full rounded bg-gray-200"></div>
							{/if}
							<span class="mt-1 block text-sm font-medium">{r.title}</span>
						</a>
						<span class="text-xs text-gray-600">
							{#if data.tab === 'saved' && r.ownerUsername}by <a
									href={resolve('/members/[username]', { username: r.ownerUsername })}
									class="underline">{r.ownerUsername}</a
								> ·
							{/if}♡ {r.likeCount}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each data.list.items as m (m.username)}
					<li>
						<a
							href={resolve('/members/[username]', { username: m.username })}
							class="flex items-center gap-3"
						>
							{#if m.iconUrl}
								<img src={m.iconUrl} alt="" class="size-10 rounded-full object-cover" />
							{:else}
								<span
									aria-hidden="true"
									class="flex size-10 items-center justify-center rounded-full bg-gray-200 font-bold text-gray-600"
									>{m.username.slice(0, 1).toUpperCase()}</span
								>
							{/if}
							<span class="font-medium">{m.username}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		{#if data.list.nextCursor}
			<p class="mt-6">
				<a
					href="{base}?tab={data.tab}&cursor={encodeURIComponent(data.list.nextCursor)}"
					class="text-sm underline">次を表示</a
				>
			</p>
		{/if}
	</section>
</main>

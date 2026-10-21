import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { follow, member, recipe, save } from '#lib/server/db/schema.js';
import { USERNAME_PATTERN } from '#lib/server/services/members/index.js';
import {
	isUuid,
	likeCountOf,
	lockPhotos,
	releaseUnreferenced,
	type Db
} from '#lib/server/services/recipes/index.js';

export const PAGE_SIZE = 24;
export const BIO_MAX = 200;

/** Same shape as the `member_icon` keys storePhoto makes; the icon shown is the small derivative. */
const ICON_KEY =
	/^member\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/list\.webp$/;

const charLength = (s: string) => [...s].length;

export type Page<T> = { items: T[]; nextCursor: string | null };

// Newest first by (time, id). The time travels as Postgres text so microseconds survive.
type Cursor = [string, string];
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(raw: string | null | undefined): Cursor | null | 'invalid' {
	if (!raw) return null;
	try {
		const c = JSON.parse(Buffer.from(raw, 'base64url').toString());
		const ts = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:\d\d)?$/;
		if (Array.isArray(c) && typeof c[0] === 'string' && ts.test(c[0]) && isUuid(c[1]))
			return [c[0], c[1]];
	} catch {
		// fall through
	}
	return 'invalid';
}

/** Runs `select` newest-first on (`time`, `id`) with keyset paging; a bad cursor yields page one. */
async function paged<T extends { t: string; i: string }>(
	time: PgColumn,
	id: PgColumn,
	cursorRaw: string | null | undefined,
	limit: number,
	select: (where: SQL | undefined, order: SQL[], take: number) => Promise<T[]>
): Promise<Page<Omit<T, 't' | 'i'>>> {
	const parsed = decode(cursorRaw);
	const cursor = parsed === 'invalid' ? null : parsed;
	const where = cursor
		? sql`(${time}, ${id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`
		: undefined;
	const rows = await select(where, [sql`${time} desc`, sql`${id} desc`], limit + 1);
	const page = rows.slice(0, limit);
	const last = page.at(-1);
	return {
		items: page.map(
			(row) =>
				Object.fromEntries(Object.entries(row).filter(([k]) => k !== 't' && k !== 'i')) as Omit<
					T,
					't' | 'i'
				>
		),
		nextCursor: rows.length > limit && last ? encode([last.t, last.i]) : null
	};
}

export type RecipeCard = {
	id: string;
	title: string;
	mainPhotoKey: string;
	ownerUsername: string | null;
	likeCount: number;
};
export type MemberCard = { username: string; iconKey: string | null };

export type Profile = {
	id: string;
	username: string;
	bio: string | null;
	iconKey: string | null;
	recipeCount: number;
	followerCount: number;
	followingCount: number;
	/** The viewer follows this Member; false for a signed-out viewer or the Member themself. */
	isFollowing: boolean;
};

const byUsername = (username: string) => sql`lower(${member.username}) = lower(${username})`;

/** FR-054: public profile; null when there is no such Member or they are suspended (FR-075). */
export async function getProfile(
	db: Db,
	username: string,
	viewerId: string | null
): Promise<Profile | null> {
	const [row] = await db
		.select({
			id: member.id,
			username: member.username,
			bio: member.bio,
			iconKey: member.iconKey,
			// Raw table names: drizzle drops the table qualifier of columns in a one-table select.
			recipeCount:
				sql<number>`(select count(*) from recipe r where r.member_id = member.id)`.mapWith(Number),
			followerCount:
				sql<number>`(select count(*) from follow f join member m on m.id = f.follower_id where f.followee_id = member.id and m.suspended_at is null)`.mapWith(
					Number
				),
			followingCount:
				sql<number>`(select count(*) from follow f join member m on m.id = f.followee_id where f.follower_id = member.id and m.suspended_at is null)`.mapWith(
					Number
				),
			isFollowing: viewerId
				? sql<boolean>`exists (select 1 from follow where follower_id = ${viewerId} and followee_id = member.id)`
				: sql<boolean>`false`
		})
		.from(member)
		.where(and(isNotNull(member.username), isNull(member.suspendedAt), byUsername(username)));
	return row?.username ? (row as Profile) : null;
}

/** The Member's own Recipes, newest first (FR-054). */
export function listMemberRecipes(
	db: Db,
	memberId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<Page<RecipeCard>> {
	return paged(
		recipe.createdAt,
		recipe.id,
		opts.cursor,
		opts.limit ?? PAGE_SIZE,
		(where, order, take) =>
			db
				.select({
					id: recipe.id,
					title: recipe.title,
					mainPhotoKey: recipe.mainPhotoKey,
					ownerUsername: member.username,
					likeCount: likeCountOf(recipe.id),
					t: sql<string>`${recipe.createdAt}::text`,
					i: sql<string>`${recipe.id}::text`
				})
				.from(recipe)
				.innerJoin(member, eq(member.id, recipe.memberId))
				.where(and(eq(recipe.memberId, memberId), where))
				.orderBy(...order)
				.limit(take)
	);
}

/**
 * The Recipes `memberId` saved, most recently saved first. The caller must only pass the
 * signed-in Member's own id: Save lists are private (FR-056). Recipes of suspended Members drop out.
 */
export function listSavedRecipes(
	db: Db,
	memberId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<Page<RecipeCard>> {
	return paged(
		save.createdAt,
		save.recipeId,
		opts.cursor,
		opts.limit ?? PAGE_SIZE,
		(where, order, take) =>
			db
				.select({
					id: recipe.id,
					title: recipe.title,
					mainPhotoKey: recipe.mainPhotoKey,
					ownerUsername: member.username,
					likeCount: likeCountOf(recipe.id),
					t: sql<string>`${save.createdAt}::text`,
					i: sql<string>`${save.recipeId}::text`
				})
				.from(save)
				.innerJoin(recipe, eq(recipe.id, save.recipeId))
				.innerJoin(member, eq(member.id, recipe.memberId))
				.where(and(eq(save.memberId, memberId), isNull(member.suspendedAt), where))
				.orderBy(...order)
				.limit(take)
	);
}

/** FR-054: the Members following `memberId`, newest first; public. */
export function listFollowers(
	db: Db,
	memberId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<Page<MemberCard>> {
	return paged(
		follow.createdAt,
		follow.followerId,
		opts.cursor,
		opts.limit ?? PAGE_SIZE,
		(where, order, take) =>
			db
				.select({
					username: sql<string>`${member.username}`,
					iconKey: member.iconKey,
					t: sql<string>`${follow.createdAt}::text`,
					i: sql<string>`${follow.followerId}::text`
				})
				.from(follow)
				.innerJoin(member, eq(member.id, follow.followerId))
				.where(
					and(
						eq(follow.followeeId, memberId),
						isNotNull(member.username),
						isNull(member.suspendedAt),
						where
					)
				)
				.orderBy(...order)
				.limit(take)
	);
}

/** FR-054: the Members `memberId` follows, newest first; public. */
export function listFollowing(
	db: Db,
	memberId: string,
	opts: { cursor?: string | null; limit?: number } = {}
): Promise<Page<MemberCard>> {
	return paged(
		follow.createdAt,
		follow.followeeId,
		opts.cursor,
		opts.limit ?? PAGE_SIZE,
		(where, order, take) =>
			db
				.select({
					username: sql<string>`${member.username}`,
					iconKey: member.iconKey,
					t: sql<string>`${follow.createdAt}::text`,
					i: sql<string>`${follow.followeeId}::text`
				})
				.from(follow)
				.innerJoin(member, eq(member.id, follow.followeeId))
				.where(
					and(
						eq(follow.followerId, memberId),
						isNotNull(member.username),
						isNull(member.suspendedAt),
						where
					)
				)
				.orderBy(...order)
				.limit(take)
	);
}

export type UpdateProfileError =
	'bio_too_long' | 'icon_key_invalid' | 'username_invalid' | 'username_taken';

const UNIQUE_VIOLATION = '23505';

/**
 * Changes Username (FR-053), bio (FR-054, at most 200 characters; blank clears it; CRLF counts and is stored as one newline) and/or icon
 * in one transaction: any rejected field leaves all of them unchanged. Fields left undefined are
 * untouched; `iconKey: null` removes the icon; an empty string is an invalid key. A new icon must be an upload (`kind = 'member'`) of
 * this Member (the key it already has stays valid). An icon that is replaced or removed has its
 * upload released in the same transaction; `releasedKeys` are its objects, for the caller to
 * delete from storage after commit.
 */
export async function updateProfile(
	db: Db,
	memberId: string,
	input: { username?: string; bio?: string; iconKey?: string | null }
): Promise<
	{ ok: true; value: { releasedKeys: string[] } } | { ok: false; error: UpdateProfileError }
> {
	const bio =
		input.bio === undefined ? undefined : input.bio.replace(/\r\n?/g, '\n').trim() || null;
	if (input.username !== undefined && !USERNAME_PATTERN.test(input.username))
		return { ok: false, error: 'username_invalid' };
	if (bio && charLength(bio) > BIO_MAX) return { ok: false, error: 'bio_too_long' };
	if (input.iconKey !== undefined && input.iconKey !== null && !ICON_KEY.test(input.iconKey))
		return { ok: false, error: 'icon_key_invalid' };
	try {
		return await db.transaction(async (tx) => {
			// Lock order is upload rows, then the Member row, as in withdrawMember, so the two cannot
			// deadlock. Only the Member can change their own icon, so the icon read here can only be stale
			// if the same Member edits twice at once; then the old upload is left for the sweep.
			let photos: Awaited<ReturnType<typeof lockPhotos>> | null = null;
			if (input.iconKey !== undefined) {
				const [before] = await tx
					.select({ iconKey: member.iconKey })
					.from(member)
					.where(eq(member.id, memberId));
				photos = await lockPhotos(
					tx,
					'member',
					[before?.iconKey, input.iconKey].filter((k): k is string => !!k)
				);
			}
			const [cur] = await tx
				.select({ iconKey: member.iconKey })
				.from(member)
				.where(eq(member.id, memberId))
				.for('update');
			if (
				input.iconKey &&
				input.iconKey !== cur?.iconKey &&
				!photos?.ownedBy(memberId, [input.iconKey])
			)
				return { ok: false as const, error: 'icon_key_invalid' as const };
			const set: Partial<typeof member.$inferInsert> = {};
			if (input.username !== undefined) set.username = input.username;
			if (bio !== undefined) set.bio = bio;
			if (input.iconKey !== undefined) set.iconKey = input.iconKey;
			if (cur && Object.keys(set).length > 0)
				await tx.update(member).set(set).where(eq(member.id, memberId));
			return {
				ok: true as const,
				value: { releasedKeys: await releaseUnreferenced(tx, 'member', photos?.ids ?? []) }
			};
		});
	} catch (e) {
		if ((e as { cause?: { code?: string } }).cause?.code === UNIQUE_VIOLATION)
			return { ok: false, error: 'username_taken' };
		throw e;
	}
}

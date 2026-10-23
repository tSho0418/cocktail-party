import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { quotaUse } from '#lib/server/db/schema.js';
import type { Db } from '#lib/server/services/recipes/recipes.js';

/**
 * Daily limits per Member (Issue #63): the free tiers (R2, Vercel CPU, Neon; ADR 0001) have no
 * room for one account to fill them. Values sit well above honest use and well below abuse:
 * - photo: one Recipe takes at most 4 photos, so 10 Recipes take 40. Every attempt counts, also
 *   a refused or undecodable one and a photo picked again, so honest use that stays under 10
 *   Recipes a day leaves room for retries. Member icons count too (same sharp and R2 cost).
 * - recipe: 10 new Recipes a day is a lot of cocktails; an edit is not a new Recipe and is free.
 * Administrators are counted like everyone else: the operator needs no more than this, and a
 * stolen administrator session is the one that should not be unlimited.
 */
export const DAILY_LIMITS = { photo: 40, recipe: 10 } as const;
export type QuotaKind = keyof typeof DAILY_LIMITS;

/** A use stops counting this long after it happened (a rolling window, not a calendar day). */
const WINDOW = sql`interval '24 hours'`;

const usesInWindow = (memberId: string, kind: QuotaKind) =>
	and(
		eq(quotaUse.memberId, memberId),
		eq(quotaUse.kind, kind),
		gt(quotaUse.createdAt, sql`now() - ${WINDOW}`)
	);

/**
 * Takes one use of `kind` for `memberId`, before the work it pays for starts. Returns the id of the
 * reserved row, or null when the Member is at `limit` uses in the last 24 hours (nothing is left
 * behind then).
 *
 * The order is what makes the limit exact under concurrency: the row is inserted first (a
 * statement of its own, visible to every later count), and only then counted, including itself.
 * Of any set of requests that were all accepted, the one that inserted last counts them all, so
 * more than `limit` can never be accepted; simultaneous requests at the edge may all be refused
 * (each sees the others), which costs the Member a retry. The window between check and use is
 * milliseconds, not the processing time of the request.
 *
 * `db` MUST be the pool (or a transaction that is already committed to nothing else): inside a
 * long transaction the insert would stay invisible to others until it commits, and the race
 * would be back. It takes no lock besides the insert's `FOR KEY SHARE` on the Member (the last
 * kind in the Lock order, README).
 *
 * The cheap first statement refuses a Member who is plainly over the limit with a single SELECT,
 * so a refused flood does not write.
 */
export async function reserveQuota(
	db: Db,
	memberId: string,
	kind: QuotaKind,
	limit: number = DAILY_LIMITS[kind]
): Promise<string | null> {
	const inserted = await db.execute<{ id: string }>(sql`
		insert into quota_use (member_id, kind)
		select ${memberId}::uuid, ${kind}
		where (select count(*) from ${quotaUse} where ${usesInWindow(memberId, kind)}) < ${limit}
		returning id`);
	const id = inserted.rows[0]?.id;
	if (!id) return null;
	const [row] = await db
		.select({ used: count() })
		.from(quotaUse)
		.where(usesInWindow(memberId, kind));
	if (row.used <= limit) return id;
	await releaseQuota(db, id);
	return null;
}

/**
 * Gives a reserved use back. For work that did nothing (a Recipe request that was rejected or only
 * answered a resend); an upload that was refused after its body was read is NOT given back, since
 * its decoding already cost CPU.
 */
export async function releaseQuota(db: Db, id: string) {
	await db.delete(quotaUse).where(eq(quotaUse.id, id));
}

/**
 * Deletes the Member's rows that no longer count. Rows are only ever read through the 24-hour
 * window, so this is housekeeping, best effort: the caller ignores a failure.
 */
export async function pruneQuotaUse(db: Db, memberId: string) {
	await db
		.delete(quotaUse)
		.where(and(eq(quotaUse.memberId, memberId), lt(quotaUse.createdAt, sql`now() - ${WINDOW}`)));
}

/** Deletes every Member's rows that no longer count (`pnpm photos:sweep`); returns how many. */
export async function pruneAllQuotaUse(db: Db) {
	const gone = await db
		.delete(quotaUse)
		.where(lt(quotaUse.createdAt, sql`now() - ${WINDOW}`))
		.returning({ id: quotaUse.id });
	return gone.length;
}

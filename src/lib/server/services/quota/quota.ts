import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { quotaUse } from '#lib/server/db/schema.js';
import type { Db } from '#lib/server/services/recipes/recipes.js';

/**
 * Daily limits per Member (Issue #63): the free tiers (R2, Vercel CPU, Neon; ADR 0001) have no
 * room for one account to fill them. Values sit well above honest use and well below abuse:
 * - photo: one Recipe takes at most 4 photos; 40 leaves room for 10 Recipes, for trying a photo
 *   again after a bad pick, and for the icon. Member icons count too (same sharp and R2 cost).
 * - recipe: 10 new Recipes a day is a lot of cocktails; an edit is not a new Recipe and is free.
 * Administrators are counted like everyone else: the operator needs no more than this, and a
 * stolen administrator session is the one that should not be unlimited.
 */
export const DAILY_LIMITS = { photo: 40, recipe: 10 } as const;
export type QuotaKind = keyof typeof DAILY_LIMITS;

/** A use stops counting this long after it happened (a rolling window, not a calendar day). */
const WINDOW = sql`interval '24 hours'`;

/**
 * Whether `memberId` has used `kind` `limit` times or more in the last 24 hours. A plain SELECT
 * that takes no lock, so it can run anywhere in a transaction without touching the Lock order
 * (README). Concurrent requests can each pass it and overshoot the limit by a few; the next one
 * is refused, so the limit still bounds a Member.
 */
export async function isOverQuota(
	db: Db,
	memberId: string,
	kind: QuotaKind,
	limit: number = DAILY_LIMITS[kind]
) {
	const [row] = await db
		.select({ used: count() })
		.from(quotaUse)
		.where(
			and(
				eq(quotaUse.memberId, memberId),
				eq(quotaUse.kind, kind),
				gt(quotaUse.createdAt, sql`now() - ${WINDOW}`)
			)
		);
	return row.used >= limit;
}

/**
 * Counts one use. These rows are separate from `photo_upload` and `recipe` on purpose: deleting a
 * Recipe or a photo must not give the use back, or upload, publish and delete in a loop would
 * never reach the limit. The insert takes only the Member's `FOR KEY SHARE` (last in the Lock order).
 */
export async function recordQuotaUse(db: Db, memberId: string, kind: QuotaKind) {
	await db.insert(quotaUse).values({ memberId, kind });
}

/**
 * Deletes the Member's rows that no longer count. Rows are only ever read through the 24-hour
 * window, so this is housekeeping; run it on a path that holds no other locks (the photo upload
 * does), so two cleanups of one Member can never wait on each other inside a larger transaction.
 */
export async function pruneQuotaUse(db: Db, memberId: string) {
	await db
		.delete(quotaUse)
		.where(and(eq(quotaUse.memberId, memberId), lt(quotaUse.createdAt, sql`now() - ${WINDOW}`)));
}

// Reports (FR-070–074) and Member Suspension (FR-075). The administrator-only reads and writes
// take the acting Member explicitly and check isAdministrator themselves (as the Ingredient
// service does), so every caller gets the same rule.
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { member, recipe, report } from '#lib/server/db/schema.js';
import { isUuid, type Actor, type Db } from '#lib/server/services/recipes/index.js';

export const REPORT_REASONS = ['inappropriate_photo', 'plagiarism', 'spam', 'other'] as const;
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const MAX_REPORT_DETAIL = 200;

type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = <E extends string>(error: E) => ({ ok: false as const, error });

const FK_VIOLATION = '23503';
const isReason = (v: unknown): v is ReportReason =>
	(REPORT_REASONS as readonly unknown[]).includes(v);
const isStatus = (v: unknown): v is ReportStatus =>
	(REPORT_STATUSES as readonly unknown[]).includes(v);

export type SubmitReportError =
	'suspended' | 'not_found' | 'invalid_reason' | 'detail_too_long' | 'duplicate';

/**
 * FR-070/071: a Member reports a Recipe once. A Recipe whose Member is suspended is hidden
 * (FR-075), so it cannot be reported either. The author is copied onto the Report so it stays
 * attributable after the Recipe is deleted (FR-073/074).
 */
export async function submitReport(
	db: Db,
	actor: Actor,
	recipeId: string,
	input: { reason: string; detail?: string | null }
): Promise<Result<{ id: string }, SubmitReportError>> {
	if (actor.suspended) return fail('suspended');
	if (!isReason(input.reason)) return fail('invalid_reason');
	const detail = input.detail?.trim() || null;
	if (detail && [...detail].length > MAX_REPORT_DETAIL) return fail('detail_too_long');
	if (!isUuid(recipeId)) return fail('not_found');

	const [target] = await db
		.select({ memberId: recipe.memberId })
		.from(recipe)
		.innerJoin(member, eq(member.id, recipe.memberId))
		.where(and(eq(recipe.id, recipeId), isNull(member.suspendedAt)));
	if (!target) return fail('not_found');

	try {
		const [row] = await db
			.insert(report)
			.values({
				recipeId,
				reporterId: actor.memberId,
				reportedMemberId: target.memberId,
				reason: input.reason,
				detail
			})
			.onConflictDoNothing()
			.returning({ id: report.id });
		return row ? ok({ id: row.id }) : fail('duplicate');
	} catch (e) {
		// The Recipe was deleted between the lookup and the insert.
		if ((e as { cause?: { code?: string } }).cause?.code === FK_VIOLATION) return fail('not_found');
		throw e;
	}
}

export type ReportRow = {
	id: string;
	status: ReportStatus;
	reason: ReportReason;
	detail: string | null;
	createdAt: Date;
	/** 'live' while the Recipe exists; otherwise why it is gone. No Recipe content is kept (FR-078). */
	targetState: 'live' | 'recipe_deleted' | 'member_withdrawn';
	recipeId: string | null;
	recipeTitle: string | null;
	/** Null when the reporter has withdrawn (FR-078). */
	reporterUsername: string | null;
	/** The Recipe's author; null once withdrawn. */
	reportedUsername: string | null;
	reportedMemberId: string | null;
	reportedSuspended: boolean;
};

export type AdminError = 'forbidden' | 'not_found';

/** FR-073: newest first, optionally only one status. */
export async function listReports(
	db: Db,
	actor: Actor,
	opts: { status?: ReportStatus; limit?: number } = {}
): Promise<Result<ReportRow[], 'forbidden'>> {
	if (!actor.isAdministrator) return fail('forbidden');
	const reporter = db
		.select({ id: member.id, username: member.username })
		.from(member)
		.as('reporter');
	const rows = await db
		.select({
			id: report.id,
			status: report.status,
			reason: report.reason,
			detail: report.detail,
			createdAt: report.createdAt,
			targetState: report.targetState,
			recipeId: report.recipeId,
			recipeTitle: recipe.title,
			reporterUsername: reporter.username,
			reportedUsername: member.username,
			reportedMemberId: report.reportedMemberId,
			reportedSuspended: sql<boolean>`${member.suspendedAt} is not null`
		})
		.from(report)
		.leftJoin(recipe, eq(recipe.id, report.recipeId))
		.leftJoin(reporter, eq(reporter.id, report.reporterId))
		.leftJoin(member, eq(member.id, report.reportedMemberId))
		.where(opts.status ? eq(report.status, opts.status) : undefined)
		.orderBy(desc(report.createdAt), desc(report.id))
		.limit(opts.limit ?? 200);
	return ok(rows);
}

/** FR-072. */
export async function setReportStatus(
	db: Db,
	actor: Actor,
	reportId: string,
	status: string
): Promise<Result<{ status: ReportStatus }, AdminError | 'invalid_status'>> {
	if (!actor.isAdministrator) return fail('forbidden');
	if (!isStatus(status)) return fail('invalid_status');
	if (!isUuid(reportId)) return fail('not_found');
	const [row] = await db
		.update(report)
		.set({ status })
		.where(eq(report.id, reportId))
		.returning({ status: report.status });
	return row ? ok(row) : fail('not_found');
}

export type SuspendedMember = { id: string; username: string; suspendedAt: Date };

/** FR-075: Suspension is a flag on the Member; every public read already filters on it. */
export async function setMemberSuspension(
	db: Db,
	actor: Actor,
	username: string,
	suspended: boolean
): Promise<Result<{ username: string; suspended: boolean }, AdminError | 'self'>> {
	if (!actor.isAdministrator) return fail('forbidden');
	const target = sql`lower(${member.username}) = lower(${username})`;
	const [row] = await db
		.select({ id: member.id, username: member.username })
		.from(member)
		.where(and(isNotNull(member.username), target));
	if (!row) return fail('not_found');
	if (row.id === actor.memberId) return fail('self');
	await db
		.update(member)
		.set({ suspendedAt: suspended ? sql`coalesce(${member.suspendedAt}, now())` : null })
		.where(eq(member.id, row.id));
	return ok({ username: row.username!, suspended });
}

export async function listSuspendedMembers(
	db: Db,
	actor: Actor
): Promise<Result<SuspendedMember[], 'forbidden'>> {
	if (!actor.isAdministrator) return fail('forbidden');
	const rows = await db
		.select({ id: member.id, username: member.username, suspendedAt: member.suspendedAt })
		.from(member)
		.where(isNotNull(member.suspendedAt))
		.orderBy(desc(member.suspendedAt));
	return ok(rows as SuspendedMember[]);
}

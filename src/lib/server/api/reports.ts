import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { db } from '#lib/server/db/index.js';
import { requireAdministrator, requireMember } from '#lib/server/auth/guards.js';
import {
	listReports,
	listSuspendedMembers,
	setMemberSuspension,
	setReportStatus,
	submitReport,
	REPORT_STATUSES
} from '#lib/server/services/reports/index.js';
import { actorOf, invalidRequest, isRecord, jsonBodyLimit, statusOf, type ApiEnv } from './http';

/** FR-070–073, FR-075. Recipe deletion (FR-074) and Ingredient edits (FR-076) use their own routes. */
export const reportsRoute = () =>
	new Hono<ApiEnv>()
		.post(
			'/recipes/:id/reports',
			requireMember,
			jsonBodyLimit,
			validator('json', (b, c) =>
				isRecord(b) &&
				typeof b.reason === 'string' &&
				(b.detail === undefined || b.detail === null || typeof b.detail === 'string')
					? { reason: b.reason, detail: b.detail as string | null | undefined }
					: invalidRequest(c)
			),
			async (c) => {
				const r = await submitReport(db, actorOf(c), c.req.param('id'), c.req.valid('json'));
				if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
				return c.json(r.value, 201);
			}
		)
		.get('/admin/reports', requireAdministrator, async (c) => {
			const status = c.req.query('status');
			const r = await listReports(db, actorOf(c), {
				status: REPORT_STATUSES.find((s) => s === status),
				cursor: c.req.query('cursor') || null
			});
			if (!r.ok)
				return r.error === 'invalid_query'
					? c.json({ error: 'invalid_request' as const }, 400)
					: c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		.patch(
			'/admin/reports/:id',
			requireAdministrator,
			jsonBodyLimit,
			validator('json', (b, c) =>
				isRecord(b) && typeof b.status === 'string' ? { status: b.status } : invalidRequest(c)
			),
			async (c) => {
				const r = await setReportStatus(
					db,
					actorOf(c),
					c.req.param('id'),
					c.req.valid('json').status
				);
				if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
				return c.json(r.value);
			}
		)
		.get('/admin/suspensions', requireAdministrator, async (c) => {
			const r = await listSuspendedMembers(db, actorOf(c));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json({ items: r.value });
		})
		.put('/admin/members/:username/suspension', requireAdministrator, async (c) => {
			const r = await setMemberSuspension(db, actorOf(c), c.req.param('username'), true);
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		.delete('/admin/members/:username/suspension', requireAdministrator, async (c) => {
			const r = await setMemberSuspension(db, actorOf(c), c.req.param('username'), false);
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		});

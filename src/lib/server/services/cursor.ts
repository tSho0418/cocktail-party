// Keyset cursors: opaque base64url JSON carrying a Postgres timestamp (as text, so microseconds
// survive) and a uuid. Validation is strict because the values go straight into `::timestamptz` /
// `::uuid` casts, where a malformed one would be a 500 instead of a rejected cursor.
import { isUuid } from '#lib/server/services/recipes/recipes.js';

// Postgres `timestamptz::text`: 2031-01-01 00:00:00.123456+00 (offset may carry minutes).
const TIMESTAMP =
	/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?([+-])(\d\d)(?::(\d\d))?$/;

/** True for a valid date-time in the form Postgres prints for `timestamptz::text` (real calendar date, time of day under 24:00, offset under 16h). */
export function isTimestampText(s: unknown): s is string {
	const m = typeof s === 'string' ? TIMESTAMP.exec(s) : null;
	if (!m) return false;
	const [year, month, day, hour, minute, second, offHour, offMinute] = [
		m[1],
		m[2],
		m[3],
		m[4],
		m[5],
		m[6],
		m[8],
		m[9] ?? '0'
	].map(Number);
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return (
		year >= 1 &&
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= daysInMonth &&
		hour < 24 &&
		minute < 60 &&
		second < 60 &&
		offHour < 16 &&
		offMinute < 60
	);
}

export const encodeCursor = (payload: unknown) =>
	Buffer.from(JSON.stringify(payload)).toString('base64url');

/** The JSON a cursor carries, or null when it is not base64url JSON. */
export function parseCursor(raw: string): unknown {
	try {
		return JSON.parse(Buffer.from(raw, 'base64url').toString());
	} catch {
		return null;
	}
}

export type TimeCursor = [time: string, id: string];

export const encodeTimeCursor = (time: string, id: string) => encodeCursor([time, id]);

/** A `[time, id]` cursor, or null when `raw` is not one. */
export function decodeTimeCursor(raw: string): TimeCursor | null {
	const c = parseCursor(raw);
	return Array.isArray(c) && isTimestampText(c[0]) && isUuid(c[1]) ? [c[0], c[1]] : null;
}

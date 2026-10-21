import { describe, expect, it } from 'vitest';
import { decodeTimeCursor, encodeTimeCursor, isTimestampText } from './cursor';

const ID = '3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9a2b34';

describe('isTimestampText', () => {
	it.each([
		'2031-01-01 00:00:00+00',
		'2031-01-01 00:00:00.6234+00',
		'2031-01-01 00:00:00.123456+00',
		'2031-01-01 12:34:56+09',
		'2031-01-01 12:34:56+05:30',
		'2031-01-01 12:34:56-03:30',
		'2028-02-29 00:00:00+00',
		'2000-02-29 00:00:00+00',
		'2031-01-01 00:00:00+15:59'
	])('accepts %s', (s) => expect(isTimestampText(s)).toBe(true));

	it.each([
		'2100-02-29 00:00:00+00',
		'2031-02-30 00:00:00+00',
		'2031-13-01 00:00:00+00',
		'2031-00-01 00:00:00+00',
		'2031-01-00 00:00:00+00',
		'2031-01-01 24:00:00+00',
		'2031-01-01 00:60:00+00',
		'2031-01-01 00:00:60+00',
		'2031-01-01 00:00:00+16',
		'2031-01-01 00:00:00+99',
		'0000-01-01 00:00:00+00',
		'2031-01-01 00:00:00+00 ',
		'2031-01-01 00:00:00+00\n',
		'x2031-01-01 00:00:00+00',
		'2031-01-01T00:00:00+00',
		'',
		null,
		42
	])('rejects %j', (s) => expect(isTimestampText(s)).toBe(false));
});

describe('time cursor', () => {
	it('round-trips time text (microseconds kept) and id', () => {
		const time = '2031-01-01 00:00:00.123401+00';
		expect(decodeTimeCursor(encodeTimeCursor(time, ID))).toEqual([time, ID]);
	});

	it('rejects non-cursors', () => {
		const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
		for (const raw of [
			'garbage',
			enc({ t: 1 }),
			enc(['2031-01-01 00:00:00+00']),
			enc(['2031-02-30 00:00:00+00', ID]),
			enc(['2031-01-01 00:00:00+00', 'not-a-uuid'])
		])
			expect(decodeTimeCursor(raw)).toBeNull();
	});
});

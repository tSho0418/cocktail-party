import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export const MAX_NAME_LENGTH = 50;

/** Name as stored: NFKC (全角英数・全角スペース → 半角, 半角カナ → 全角), whitespace collapsed. */
export const normalizeIngredientName = (name: string) =>
	name.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Comparison key for FR-014 duplicates: the stored form, case-folded. */
export const ingredientNameKey = (name: string) => normalizeIngredientName(name).toLowerCase();

/** SQL twin of ingredientNameKey, so rows inserted by any path compare the same way. */
export const ingredientNameKeySql = (col: AnyPgColumn): SQL<string> =>
	sql`lower(btrim(regexp_replace(normalize(${col}, NFKC), '\\s+', ' ', 'g')))`;

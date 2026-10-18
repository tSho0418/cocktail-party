// Alcohol Content rules (FR-004/005, FR-015, FR-020–026). Pure: no I/O, no framework imports.

export type MixItem = { mixRatio: number; abvPercent: number };

export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

/**
 * True when `n` has at most one decimal digit as a JS number would hold it after parsing,
 * e.g. 0.3 or Number('12.5'). Arithmetic noise such as 0.1 + 0.2 (0.30000000000000004) is
 * rejected rather than silently rounded: callers must pass the value as entered or as read
 * from a numeric(_, 1) column. NaN fails here too.
 */
export const hasAtMostOneDecimal = (n: number) => Math.round(n * 10) / 10 === n;

/**
 * Round to the scale of the numeric(4, 1) ABV columns in schema.ts: one decimal, half up
 * (ABV is never negative, so this matches Postgres's half-away-from-zero). toPrecision(12)
 * first strips float noise so 0.15 rounds to 0.2 like the decimal it stands for.
 */
export const roundAbv = (n: number) => Math.round(Number((n * 10).toPrecision(12))) / 10;

/** FR-020: weighted mean of Ingredient ABV by Mix Ratio, at full precision. */
export function computeAutoAbv(items: readonly MixItem[]): number {
	// FR-004: a Recipe always has a liquid Ingredient, so empty input is a programming error.
	if (items.length === 0) throw new RangeError('A Recipe needs at least one Ingredient');
	let weighted = 0;
	let total = 0;
	for (const { mixRatio, abvPercent } of items) {
		weighted += mixRatio * abvPercent;
		total += mixRatio;
	}
	return weighted / total;
}

/** FR-025: a Recipe has alcohol iff any Ingredient's ABV is above 0. */
export const hasAlcohol = (items: readonly Pick<MixItem, 'abvPercent'>[]) =>
	items.some((i) => i.abvPercent > 0);

export const isNonAlcoholic = (items: readonly Pick<MixItem, 'abvPercent'>[]) => !hasAlcohol(items);

/** FR-005: 0.1 ≤ Mix Ratio ≤ 99.9, at most one decimal digit. */
export function validateMixRatio(r: number): Result<number, 'too_many_decimals' | 'out_of_range'> {
	if (!hasAtMostOneDecimal(r)) return { ok: false, error: 'too_many_decimals' };
	if (r < 0.1 || r > 99.9) return { ok: false, error: 'out_of_range' };
	return { ok: true, value: r };
}

export type OverrideInput = { override: number; hasAlcohol: boolean; maxIngredientAbv: number };

/**
 * FR-021/022/024: an override needs a Recipe with alcohol and must satisfy
 * 0 < override ≤ highest Ingredient ABV. It also needs at most one decimal, since the
 * column would otherwise round it (0.04 would be stored as 0.0, breaking "> 0").
 */
export function validateAbvOverride({
	override,
	hasAlcohol,
	maxIngredientAbv
}: OverrideInput): Result<number, 'no_alcohol' | 'too_many_decimals' | 'out_of_range'> {
	if (!hasAlcohol) return { ok: false, error: 'no_alcohol' };
	if (!hasAtMostOneDecimal(override)) return { ok: false, error: 'too_many_decimals' };
	if (override <= 0 || override > maxIngredientAbv) return { ok: false, error: 'out_of_range' };
	return { ok: true, value: override };
}

/** The Alcohol Content to show and filter by (FR-021, FR-024, FR-044). */
export function resolveEffectiveAbv({
	autoAbv,
	hasAlcohol,
	override
}: {
	autoAbv: number;
	hasAlcohol: boolean;
	override?: number | null;
}): { value: number; isOverride: boolean } {
	if (!hasAlcohol) return { value: 0, isOverride: false };
	if (override != null) return { value: override, isOverride: true };
	return { value: autoAbv, isOverride: false };
}

/** FR-015: after Ingredients change, drop an override that no longer fits; otherwise keep it (FR-023). */
export function reconcileOverrideAfterIngredientChange({
	override,
	...rest
}: Omit<OverrideInput, 'override'> & { override: number | null }): {
	override: number | null;
	discarded: boolean;
} {
	if (override == null) return { override: null, discarded: false };
	return validateAbvOverride({ override, ...rest }).ok
		? { override, discarded: false }
		: { override: null, discarded: true };
}

/** FR-026: Base Ingredient ids, de-duplicated, in first-seen order. */
export const deriveBases = <Id>(
	ingredients: readonly { id: Id; isBaseSpirit: boolean }[]
): Id[] => [...new Set(ingredients.filter((i) => i.isBaseSpirit).map((i) => i.id))];

/**
 * ADR 0004: the derived Recipe columns, recomputed in the same transaction as their inputs.
 * autoAbv is rounded with roundAbv to fit recipe.auto_abv; maxIngredientAbv is 0 without alcohol.
 */
export function recomputeDerived<Id>(
	items: readonly (MixItem & { id: Id; isBaseSpirit: boolean })[]
): { autoAbv: number; hasAlcohol: boolean; maxIngredientAbv: number; baseIngredientIds: Id[] } {
	return {
		autoAbv: roundAbv(computeAutoAbv(items)),
		hasAlcohol: hasAlcohol(items),
		maxIngredientAbv: Math.max(0, ...items.map((i) => i.abvPercent)),
		baseIngredientIds: deriveBases(items)
	};
}

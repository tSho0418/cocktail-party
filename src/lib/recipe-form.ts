// Pure state and rules behind the Recipe post/edit form (FR-003..007, FR-020..024). No I/O, no framework imports.
import {
	MAX_INGREDIENTS,
	hasAlcohol,
	recomputeDerived,
	validateAbvOverride,
	validateMixRatio
} from '#lib/domain/alcohol/index.js';

export const MAX_TITLE = 50;
export const MAX_DESCRIPTION = 500;
export const MAX_EXTRA_PHOTOS = 3;
export const MAX_STEPS = 10;
export const MAX_STEP_LENGTH = 200;
export { MAX_INGREDIENTS };

export type IngredientOption = {
	id: string;
	name: string;
	abvPercent: number;
	isBaseSpirit: boolean;
};

/** `key` is the stored `recipe/<uuid>/list.webp` key; `url` previews it (null when no public URL is configured). */
export type PhotoRef = { key: string; url: string | null };

export type IngredientRow = {
	/** Stable id for {#each}; not sent. */
	rowId: number;
	ingredient: IngredientOption;
	/** As typed; parsed by parseMixRatio. */
	mixRatio: string;
};

export type FormValues = {
	title: string;
	description: string;
	mainPhoto: PhotoRef | null;
	extraPhotos: PhotoRef[];
	ingredients: IngredientRow[];
	steps: string[];
	/** As typed; empty = no override (auto value). */
	abvOverride: string;
};

export type RecipePayload = {
	title: string;
	description: string;
	mainPhotoKey: string;
	extraPhotoKeys: string[];
	ingredients: { ingredientId: string; mixRatio: number }[];
	steps: string[];
	abvOverride: number | null;
};

// Postgres char_length counts code points, JS .length counts UTF-16 units.
const charLength = (s: string) => [...s].length;

/** NFKC so full-width digits and "．" typed with a Japanese IME ("１２", "１．５") read as ASCII. Digits and one decimal point only. */
const typedNumber = (text: string): number | null => {
	const t = text.normalize('NFKC').trim();
	if (t === '') return null;
	return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

/** A typed Mix Ratio (FR-005) as a number, or null when empty or not valid. */
export function parseMixRatio(text: string): number | null {
	const n = typedNumber(text);
	if (n === null) return null;
	const v = validateMixRatio(n);
	return v.ok ? v.value : null;
}

export type AlcoholPreview = {
	hasAlcohol: boolean;
	maxIngredientAbv: number;
	/**
	 * Auto value (FR-020). Null while no row, or any row, still lacks a valid Mix Ratio: a partial
	 * sum would be wrong.
	 */
	autoAbv: number | null;
	/** 'none' | an override that fits FR-022 | one that does not. */
	override:
		| { state: 'none' }
		| { state: 'valid'; value: number }
		| { state: 'invalid'; reason: 'not_a_number' | 'too_many_decimals' | 'out_of_range' };
	/** What the Recipe will show: the override when valid, else the auto value. */
	effectiveAbv: number | null;
};

/**
 * FR-020..024 live: the auto value and the verdict on the typed override, through the same
 * rules the server applies on save. The auto value waits until every row has a valid Mix Ratio.
 */
export function previewAlcohol(
	rows: readonly Pick<IngredientRow, 'ingredient' | 'mixRatio'>[],
	overrideText: string
): AlcoholPreview {
	// A duplicate Ingredient is reported by validateForm; the preview must not count it twice.
	const seen = new Set<string>();
	const selected = rows.filter(
		({ ingredient }) => !seen.has(ingredient.id) && seen.add(ingredient.id)
	);
	// "Has alcohol" and the override range follow the chosen Ingredients, not their Mix Ratios, so a
	// half-typed ratio (backspace, "0" on the way to "0.5") never changes what the override may be.
	const alcohol = hasAlcohol(selected.map((r) => r.ingredient));
	const maxIngredientAbv = Math.max(0, ...selected.map((r) => r.ingredient.abvPercent));
	const typed = typedNumber(overrideText);
	let override: AlcoholPreview['override'] = { state: 'none' };
	if (alcohol && typed !== null) {
		const v = validateAbvOverride({ override: typed, hasAlcohol: true, maxIngredientAbv });
		override = v.ok
			? { state: 'valid', value: v.value }
			: {
					state: 'invalid',
					reason: v.error as 'not_a_number' | 'too_many_decimals' | 'out_of_range'
				};
	}
	// The auto value (FR-020) is shown only once every chosen row has a valid Mix Ratio: a partial
	// sum would read too high or too low.
	const counted = selected.flatMap(({ ingredient, mixRatio }) => {
		const ratio = parseMixRatio(mixRatio);
		return ratio === null ? [] : [{ ...ingredient, mixRatio: ratio }];
	});
	const autoAbv =
		counted.length > 0 && counted.length === selected.length
			? recomputeDerived(counted).autoAbv
			: null;
	return {
		hasAlcohol: alcohol,
		maxIngredientAbv,
		autoAbv,
		override,
		effectiveAbv: override.state === 'valid' ? override.value : autoAbv
	};
}

export type FormErrors = {
	title?: string;
	description?: string;
	mainPhoto?: string;
	ingredients?: string;
	/** By IngredientRow.rowId. */
	rows: Record<number, string>;
	steps?: string;
	/** By step index. */
	stepRows: Record<number, string>;
	abvOverride?: string;
};

export const hasErrors = (e: FormErrors) =>
	Object.values(e).some((v) => (typeof v === 'object' ? Object.keys(v).length > 0 : !!v));

export function overrideMessage(p: AlcoholPreview): string | undefined {
	if (p.override.state !== 'invalid') return undefined;
	return p.override.reason === 'too_many_decimals'
		? '修正値は小数点以下1桁までにしてください。'
		: p.override.reason === 'not_a_number'
			? '修正値は数値で入力してください。'
			: `修正値は 0% を超え、材料の最高度数 ${p.maxIngredientAbv}% 以下にしてください。`;
}

/** FR-003..007, FR-022: the same bounds the server enforces, in Japanese, so most mistakes never leave the browser. */
export function validateForm(v: FormValues): FormErrors {
	const e: FormErrors = { rows: {}, stepRows: {} };
	const title = v.title.trim();
	if (title === '') e.title = 'タイトルを入力してください。';
	else if (charLength(title) > MAX_TITLE) e.title = `タイトルは ${MAX_TITLE} 字までです。`;
	if (charLength(v.description.trim()) > MAX_DESCRIPTION)
		e.description = `紹介文は ${MAX_DESCRIPTION} 字までです。`;
	if (!v.mainPhoto) e.mainPhoto = '完成写真(メイン写真)を選んでください。';

	if (v.ingredients.length === 0) e.ingredients = '材料を1つ以上追加してください。';
	const seen = new Set<string>();
	for (const r of v.ingredients) {
		if (seen.has(r.ingredient.id)) e.rows[r.rowId] = '同じ材料は1回だけ入れられます。';
		seen.add(r.ingredient.id);
		if (!e.rows[r.rowId] && parseMixRatio(r.mixRatio) === null)
			e.rows[r.rowId] = '混ぜる割合を 0.1〜99.9(小数点以下1桁まで)で入力してください。';
	}

	const steps = v.steps.map((s) => s.trim());
	if (steps.length === 0) e.steps = '手順を1つ以上書いてください。';
	steps.forEach((s, i) => {
		if (s === '') e.stepRows[i] = '手順が空です。書くか、削除してください。';
		else if (charLength(s) > MAX_STEP_LENGTH)
			e.stepRows[i] = `1ステップは ${MAX_STEP_LENGTH} 字までです。`;
	});

	const preview = previewAlcohol(v.ingredients, v.abvOverride);
	e.abvOverride = overrideMessage(preview);
	return e;
}

/** The request body for POST/PUT /api/recipes. Call only when validateForm found no errors. */
export function toPayload(v: FormValues): RecipePayload {
	const preview = previewAlcohol(v.ingredients, v.abvOverride);
	return {
		title: v.title.trim(),
		description: v.description.trim(),
		mainPhotoKey: v.mainPhoto!.key,
		extraPhotoKeys: v.extraPhotos.map((p) => p.key),
		ingredients: v.ingredients.map((r) => ({
			ingredientId: r.ingredient.id,
			mixRatio: parseMixRatio(r.mixRatio)!
		})),
		steps: v.steps.map((s) => s.trim()),
		// Explicit on every save: what the form shows is what is stored (FR-021, FR-023);
		// null drops any stored override ("再計算する", or a Recipe without alcohol, FR-024).
		abvOverride: preview.override.state === 'valid' ? preview.override.value : null
	};
}

/** Japanese text for an `{ error }` code from the Recipe, Ingredient and Photo APIs. */
export const API_ERRORS: Record<string, string> = {
	unauthorized: 'ログインが切れました。ログインし直してください。',
	username_required: 'Username を設定してください。',
	suspended: 'このアカウントは利用を停止されています。',
	forbidden: 'この操作はできません。',
	not_found: '見つかりませんでした。',
	invalid_request: '入力内容を確認してください。',
	title_invalid: `タイトルは 1〜${MAX_TITLE} 字で入力してください。`,
	description_too_long: `紹介文は ${MAX_DESCRIPTION} 字までです。`,
	main_photo_required: '完成写真(メイン写真)を選んでください。',
	photo_key_invalid: '写真をもう一度選んでください。',
	too_many_photos: `追加の写真は ${MAX_EXTRA_PHOTOS} 枚までです。`,
	steps_invalid: `手順は 1〜${MAX_STEPS} ステップ、1ステップ ${MAX_STEP_LENGTH} 字までです。`,
	ingredients_empty: '材料を1つ以上追加してください。',
	too_many_ingredients: `材料は ${MAX_INGREDIENTS} 個までです。`,
	duplicate_ingredient: '同じ材料は1回だけ入れられます。',
	mix_ratio_invalid: '混ぜる割合は 0.1〜99.9(小数点以下1桁まで)にしてください。',
	unknown_ingredient: '存在しない材料が含まれています。選び直してください。',
	override_not_allowed: '酒類を含まないレシピの度数は修正できません。',
	override_invalid: '修正値が範囲外です。0% を超え、材料の最高度数以下にしてください。',
	unsupported_media_type: 'この形式の写真は送れません。',
	too_large: '写真が大きすぎます。別の写真を選んでください。',
	invalid_image: 'この写真は使えません。別の写真を選んでください。',
	// POST /api/photos 422: the codes of `ProcessError` (services/images/process.ts).
	unsupported_format: 'JPEG、PNG、WebP の写真を選んでください。',
	format_mismatch: 'この写真は読み込めませんでした。別の写真を選んでください。',
	undecodable: 'この写真は読み込めませんでした。別の写真を選んでください。',
	too_many_pixels: '写真の解像度が高すぎます。別の写真を選んでください。',
	// 429: the Member's daily limits (services/quota). They lift by themselves within 24 hours.
	photo_daily_limit:
		'1日にアップロードできる写真の数の上限に達しました。しばらく(最長24時間)待ってからお試しください。',
	recipe_daily_limit:
		'1日に投稿できるレシピの数の上限に達しました。しばらく(最長24時間)待ってからお試しください。'
};

export const apiErrorMessage = (
	code: unknown,
	fallback = '失敗しました。時間をおいてもう一度お試しください。'
) => (typeof code === 'string' ? (API_ERRORS[code] ?? fallback) : fallback);

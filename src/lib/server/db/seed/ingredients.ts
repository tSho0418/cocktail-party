// DT-001 / FR-011: the initial Ingredient master. Typical ABVs; brands avoided.
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ingredientNameKey, ingredientNameKeySql } from '../../services/ingredients/name';
import { ingredient } from '../schema';

export type SeedIngredient = { name: string; abvPercent: number; isBaseSpirit: boolean };

const base = (name: string, abvPercent: number): SeedIngredient => ({
	name,
	abvPercent,
	isBaseSpirit: true
});
const alcoholic = (name: string, abvPercent: number): SeedIngredient => ({
	name,
	abvPercent,
	isBaseSpirit: false
});
const zero = (name: string): SeedIngredient => ({ name, abvPercent: 0, isBaseSpirit: false });

export const alcoholicIngredients: SeedIngredient[] = [
	// Spirits (Base)
	base('ジン', 40.0),
	base('ウォッカ', 40.0),
	base('ホワイトラム', 40.0),
	base('ダークラム', 40.0),
	base('テキーラ', 40.0),
	base('メスカル', 40.0),
	base('スコッチウイスキー', 40.0),
	base('バーボンウイスキー', 40.0),
	base('ライウイスキー', 40.0),
	base('ジャパニーズウイスキー', 43.0),
	base('アイリッシュウイスキー', 40.0),
	base('ブランデー', 40.0),
	base('コニャック', 40.0),
	base('カルヴァドス', 40.0),
	base('ピスコ', 40.0),
	base('カシャーサ', 40.0),
	base('焼酎', 25.0),
	base('スピリタス', 96.0),
	// Liqueurs and vermouth
	alcoholic('ホワイトキュラソー', 40.0),
	alcoholic('ブルーキュラソー', 25.0),
	alcoholic('ドライ・ベルモット', 18.0),
	alcoholic('スイート・ベルモット', 16.0),
	alcoholic('カンパリ', 25.0),
	alcoholic('アペロール', 11.0),
	alcoholic('カシスリキュール', 20.0),
	alcoholic('ピーチリキュール', 20.0),
	alcoholic('アマレット', 28.0),
	alcoholic('コーヒーリキュール', 20.0),
	alcoholic('マラスキーノ', 32.0),
	alcoholic('ミントリキュール', 24.0),
	alcoholic('カカオリキュール', 24.0),
	alcoholic('ライチリキュール', 20.0),
	alcoholic('メロンリキュール', 20.0),
	alcoholic('アプリコットブランデー', 24.0),
	alcoholic('チェリーブランデー', 24.0),
	alcoholic('ココナッツリキュール', 21.0),
	alcoholic('ヘーゼルナッツリキュール', 20.0),
	alcoholic('エルダーフラワーリキュール', 20.0),
	alcoholic('スロージン', 26.0),
	alcoholic('アイリッシュクリーム', 17.0),
	alcoholic('アブサン', 68.0),
	alcoholic('梅酒', 12.0),
	// Wine, beer and other brewed
	alcoholic('赤ワイン', 13.0),
	alcoholic('白ワイン', 12.0),
	alcoholic('スパークリングワイン', 12.0),
	alcoholic('シェリー', 17.0),
	alcoholic('ポートワイン', 20.0),
	alcoholic('ビール', 5.0),
	alcoholic('黒ビール', 5.0),
	alcoholic('日本酒', 15.0),
	alcoholic('シードル', 5.0)
];

export const zeroAbvIngredients: SeedIngredient[] = [
	'オレンジジュース',
	'グレープフルーツジュース',
	'パイナップルジュース',
	'クランベリージュース',
	'トマトジュース',
	'アップルジュース',
	'ライムジュース',
	'レモンジュース',
	'マンゴージュース',
	'ピーチジュース',
	'グレナデンシロップ',
	'ガムシロップ',
	'ハニーシロップ',
	'ミントシロップ',
	'ライムコーディアル',
	'炭酸水',
	'トニックウォーター',
	'ジンジャーエール',
	'コーラ',
	'サイダー',
	'ウーロン茶',
	'緑茶',
	'紅茶',
	'コーヒー',
	'エスプレッソ',
	'牛乳',
	'生クリーム',
	'ココナッツミルク',
	'水',
	'ノンアルコールビール'
].map(zero);

export const seedIngredientList = [...alcoholicIngredients, ...zeroAbvIngredients];

/**
 * Idempotent: inserts each Ingredient unless one with the same normalized name exists.
 * Existing rows are left alone (not upserted): changing an ABV here would bypass the
 * Recipe recompute of FR-015, so ABV edits go through updateIngredientAbv.
 * Returns the number of rows inserted.
 */
export async function seedIngredients<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
	return db.transaction(async (tx) => {
		let inserted = 0;
		for (const i of seedIngredientList) {
			const { rowCount } = await tx.execute(sql`
				INSERT INTO ${ingredient} (name, abv_percent, is_base_spirit)
				SELECT ${i.name}, ${i.abvPercent}, ${i.isBaseSpirit}
				WHERE NOT EXISTS (
					SELECT 1 FROM ${ingredient}
					WHERE ${ingredientNameKeySql(ingredient.name)} = ${ingredientNameKey(i.name)}
				)`);
			inserted += rowCount ?? 0;
		}
		return inserted;
	});
}

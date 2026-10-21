// DT-002: about 20 demo Recipes. They go through createRecipe, so every FR-003..007 rule and the
// derived Alcohol columns (ADR 0004) are the real ones. Mix Ratios are bare parts (FR-005), taken from
// the standard proportions of each cocktail (ml, scaled down where a part would exceed the 99.9 cap);
// non-liquid items go into the steps (FR-006).
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import sharp from 'sharp';
import { ingredientNameKey } from '../../services/ingredients/name';
import type { ImageStore } from '../../services/images/store';
import { storePhoto } from '../../services/images/store-photo';
import { recordPhotoUpload } from '../../services/recipes/photos';
import { createRecipe, type RecipeInput } from '../../services/recipes/recipes';
import * as schema from '../schema';
import { ingredient, member, photoUpload, recipe } from '../schema';

/** Direct Member rows, outside Better Auth: no `account` row, so nobody can log in as the author. */
export const DEMO_USERNAME = 'demo_bartender';

export type SeedRecipe = {
	title: string;
	description: string;
	/** Ingredient name and Mix Ratio. */
	ingredients: [string, number][];
	steps: string[];
};

export const seedRecipeList: SeedRecipe[] = [
	{
		title: 'マティーニ',
		description: 'ジンとドライ・ベルモットだけで作る、辛口の定番。よく冷やして飲みます。',
		ingredients: [
			['ジン', 60],
			['ドライ・ベルモット', 10]
		],
		steps: [
			'ミキシンググラスに氷を入れ、ジンとドライ・ベルモットを注ぐ。',
			'バースプーンで約15回、静かにステアして冷やす。',
			'冷やしたカクテルグラスに濾して注ぎ、お好みでオリーブを沈める。'
		]
	},
	{
		title: 'ギムレット',
		description: 'ジンとライムの、すっきり引き締まった一杯。',
		ingredients: [
			['ジン', 45],
			['ライムコーディアル', 15]
		],
		steps: [
			'シェイカーに氷、ジン、ライムコーディアルを入れる。',
			'しっかりとシェイクする。',
			'カクテルグラスに濾して注ぐ。'
		]
	},
	{
		title: 'ジントニック',
		description: 'ジンをトニックウォーターで割る、作りやすい定番。ライムを搾ると香りが立ちます。',
		ingredients: [
			['ジン', 45],
			['トニックウォーター', 90]
		],
		steps: [
			'氷を入れたタンブラーにジンを注ぐ。',
			'トニックウォーターを静かに注ぎ、バースプーンで1回だけ混ぜる。',
			'くし切りのライムを搾り入れる。'
		]
	},
	{
		title: 'モスコミュール',
		description: 'ウォッカにジンジャーエールとライムを合わせた、さっぱりしたロングドリンク。',
		ingredients: [
			['ウォッカ', 45],
			['ライムジュース', 15],
			['ジンジャーエール', 90]
		],
		steps: [
			'氷を入れたタンブラーに、ウォッカとライムジュースを注ぐ。',
			'冷えたジンジャーエールを静かに満たす。',
			'軽く混ぜ、ライムの輪切りを飾る。'
		]
	},
	{
		title: 'ブラッディ・メアリー',
		description: 'ウォッカをトマトジュースで割る一杯。塩とこしょう、タバスコで好みの辛さにします。',
		ingredients: [
			['ウォッカ', 45],
			['トマトジュース', 90],
			['レモンジュース', 15]
		],
		steps: [
			'氷を入れたタンブラーに、ウォッカとレモンジュースを注ぐ。',
			'冷やしたトマトジュースを注ぎ、静かに混ぜる。',
			'塩、こしょう、タバスコを少量ずつ加えて整え、セロリがあれば添える。'
		]
	},
	{
		title: 'ダイキリ',
		description: 'ホワイトラムとライムの、甘酸っぱくて軽い定番。',
		ingredients: [
			['ホワイトラム', 45],
			['ライムジュース', 25],
			['ガムシロップ', 10]
		],
		steps: [
			'シェイカーに氷、ホワイトラム、ライムジュース、ガムシロップを入れる。',
			'しっかりとシェイクする。',
			'冷やしたカクテルグラスに濾して注ぐ。'
		]
	},
	{
		title: 'モヒート',
		description: 'ミントとライムの香りが爽やかな、ラムのロングドリンク。',
		ingredients: [
			['ホワイトラム', 45],
			['ライムジュース', 25],
			['ガムシロップ', 15],
			['炭酸水', 60]
		],
		steps: [
			'タンブラーにミントの葉を8枚ほど入れ、ライムジュースとガムシロップを加えて、葉を軽く潰す。',
			'砕いた氷を入れ、ホワイトラムを注ぐ。',
			'炭酸水を満たして底から軽く混ぜ、ミントの枝を飾る。'
		]
	},
	{
		title: 'キューバ・リブレ',
		description: 'ラムをコーラで割り、ライムを搾る、気軽に作れる一杯。',
		ingredients: [
			['ホワイトラム', 4.5],
			['コーラ', 12],
			['ライムジュース', 1]
		],
		steps: [
			'氷を入れたタンブラーに、ホワイトラムとライムジュースを注ぐ。',
			'冷えたコーラを静かに満たし、軽く混ぜる。',
			'ライムの輪切りを飾る。'
		]
	},
	{
		title: 'マルガリータ',
		description: 'テキーラ、キュラソー、ライムを合わせます。グラスの縁に塩をつけて飲む一杯。',
		ingredients: [
			['テキーラ', 50],
			['ホワイトキュラソー', 20],
			['ライムジュース', 15]
		],
		steps: [
			'カクテルグラスの縁をライムで湿らせ、塩をつけておく(ソルトスノースタイル)。',
			'シェイカーに氷とすべての材料を入れ、しっかりとシェイクする。',
			'用意したグラスに濾して注ぐ。'
		]
	},
	{
		title: 'テキーラ・サンライズ',
		description: 'グレナデンシロップが沈み、朝焼けのような色の層になる一杯。',
		ingredients: [
			['テキーラ', 45],
			['オレンジジュース', 90],
			['グレナデンシロップ', 15]
		],
		steps: [
			'氷を入れたタンブラーに、テキーラとオレンジジュースを注いで軽く混ぜる。',
			'グレナデンシロップをグラスの内側に沿って静かに注ぎ、底に沈める。',
			'混ぜずに出し、飲むときに好みで混ぜる。'
		]
	},
	{
		title: 'オールド・ファッションド',
		description: 'バーボンの味をそのまま楽しむ、甘めのロック・スタイル。',
		ingredients: [
			['バーボンウイスキー', 60],
			['ガムシロップ', 5]
		],
		steps: [
			'ロックグラスにガムシロップとアロマティック・ビターズを2、3滴入れる。',
			'大きめの氷とバーボンを入れ、バースプーンで静かに混ぜる。',
			'オレンジピールを搾って香りをつける。'
		]
	},
	{
		title: 'ウイスキー・ハイボール',
		description: 'スコッチウイスキーを炭酸水で割る、食事にも合う定番。',
		ingredients: [
			['スコッチウイスキー', 1],
			['炭酸水', 3]
		],
		steps: [
			'氷をいっぱいに入れたタンブラーを冷やし、ウイスキーを注ぐ。',
			'炭酸水を氷に当てないよう静かに注ぎ、マドラーで縦に1回だけ混ぜる。'
		]
	},
	{
		title: 'サイドカー',
		description: 'ブランデーにキュラソーとレモンを合わせた、キレのある甘酸っぱさ。',
		ingredients: [
			['ブランデー', 40],
			['ホワイトキュラソー', 20],
			['レモンジュース', 20]
		],
		steps: [
			'シェイカーに氷とすべての材料を入れる。',
			'しっかりとシェイクする。',
			'冷やしたカクテルグラスに濾して注ぐ。'
		]
	},
	{
		title: 'カシスオレンジ',
		description: '甘くて飲みやすく、お酒に慣れていない人にも出しやすい一杯。',
		ingredients: [
			['カシスリキュール', 45],
			['オレンジジュース', 90]
		],
		steps: [
			'氷を入れたタンブラーにカシスリキュールを注ぐ。',
			'オレンジジュースを静かに満たし、軽く混ぜる。'
		]
	},
	{
		title: '梅酒ソーダ',
		description: '梅酒を炭酸水で割る、家でも作りやすい軽い一杯。',
		ingredients: [
			['梅酒', 60],
			['炭酸水', 60]
		],
		steps: [
			'氷を入れたグラスに梅酒を注ぐ。',
			'炭酸水を静かに注ぎ、軽く混ぜる。',
			'お好みでレモンの輪切りを飾る。'
		]
	},
	{
		title: 'ミモザ',
		description: 'スパークリングワインとオレンジジュースを同量で合わせる、華やかな一杯。',
		ingredients: [
			['スパークリングワイン', 75],
			['オレンジジュース', 75]
		],
		steps: [
			'シャンパングラスを冷やしておく。',
			'オレンジジュースを注ぎ、静かにスパークリングワインを満たす。',
			'混ぜずに、ゆっくり1回だけ持ち上げるように合わせる。'
		]
	},
	{
		title: 'シンデレラ',
		description: '3種のジュースを合わせる、お酒を使わない定番。',
		ingredients: [
			['オレンジジュース', 20],
			['レモンジュース', 20],
			['パイナップルジュース', 20]
		],
		steps: [
			'シェイカーに氷とすべてのジュースを入れる。',
			'しっかりとシェイクして、カクテルグラスに濾して注ぐ。'
		]
	},
	{
		title: 'シャーリー・テンプル',
		description: 'ジンジャーエールにグレナデンシロップの赤を加えた、お酒を使わない一杯。',
		ingredients: [
			['ジンジャーエール', 12],
			['グレナデンシロップ', 1],
			['ライムジュース', 0.5]
		],
		steps: [
			'氷を入れたタンブラーにジンジャーエールを注ぐ。',
			'グレナデンシロップとライムジュースを加え、軽く混ぜる。',
			'お好みでマラスキーノチェリーを飾る。'
		]
	},
	{
		title: 'バージン・モヒート',
		description: 'モヒートからラムを抜いた、ミントとライムのノンアルコール。',
		ingredients: [
			['ライムジュース', 25],
			['ガムシロップ', 15],
			['炭酸水', 90]
		],
		steps: [
			'タンブラーにミントの葉を8枚ほど入れ、ライムジュースとガムシロップを加えて、葉を軽く潰す。',
			'砕いた氷を入れ、炭酸水を満たす。',
			'底から軽く混ぜ、ミントの枝を飾る。'
		]
	},
	{
		title: 'バージン・ピニャ・コラーダ',
		description: 'パイナップルとココナッツの、デザートのようなノンアルコール。',
		ingredients: [
			['パイナップルジュース', 90],
			['ココナッツミルク', 30],
			['生クリーム', 30]
		],
		steps: [
			'シェイカーに氷とすべての材料を入れる。',
			'しっかりとシェイクする。',
			'氷を入れた大きめのグラスに濾して注ぎ、お好みでパイナップルを飾る。'
		]
	}
];

/** A gradient card in a hue taken from the title; stands in for a photo (a real Photo is required, FR-007). */
export function demoPhoto(title: string) {
	const hue = [...title].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 360, 7);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},75%,35%)"/>
</linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/></svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Idempotent: the demo Member is created if missing, and each Recipe is added only when that Member
 * has none with the same title. A photo is stored in `store` only for the Recipes that get added.
 * Needs the DT-001 Ingredients (`pnpm db:seed:ingredients`). Returns the number of Recipes added.
 */
export async function seedRecipes(pool: pg.Pool, store: ImageStore) {
	const db = drizzle({ client: pool, schema });
	const names = new Map(
		(await db.select({ id: ingredient.id, name: ingredient.name }).from(ingredient)).map((i) => [
			ingredientNameKey(i.name),
			i.id
		])
	);
	const idOf = (name: string) => {
		const id = names.get(ingredientNameKey(name));
		if (!id) throw new Error(`Ingredient "${name}" is missing; run pnpm db:seed:ingredients first`);
		return id;
	};
	const inputs = seedRecipeList.map((r) => ({
		title: r.title,
		description: r.description,
		ingredients: r.ingredients.map(([name, mixRatio]) => ({
			ingredientId: idOf(name),
			mixRatio
		})),
		steps: r.steps
	}));

	const findDemo = async () =>
		(
			await db
				.select({ id: member.id })
				.from(member)
				.where(sql`lower(${member.username}) = ${DEMO_USERNAME}`)
		)[0];
	const demo =
		(await findDemo()) ??
		(
			await db
				.insert(member)
				.values({ username: DEMO_USERNAME, bio: 'デモ用の Recipe を投稿しているアカウントです。' })
				.returning({ id: member.id })
		)[0];
	const existing = new Set(
		(await db.select({ title: recipe.title }).from(recipe).where(eq(recipe.memberId, demo.id))).map(
			(r) => r.title
		)
	);

	let added = 0;
	for (const input of inputs) {
		if (existing.has(input.title)) continue;
		const photo = await storePhoto(store, await demoPhoto(input.title), 'recipe');
		if (!photo.ok) throw new Error(`photo for ${input.title}: ${photo.error}`);
		await recordPhotoUpload(db, demo.id, 'recipe', photo.id);
		const created = await createRecipe(db, { memberId: demo.id, isAdministrator: false }, {
			...input,
			mainPhotoKey: photo.keys.list
		} satisfies RecipeInput);
		if (!created.ok) {
			await db.delete(photoUpload).where(eq(photoUpload.id, photo.id));
			await Promise.allSettled([store.delete(photo.keys.list), store.delete(photo.keys.detail)]);
			throw new Error(`${input.title}: ${created.error}`);
		}
		added++;
	}
	return added;
}

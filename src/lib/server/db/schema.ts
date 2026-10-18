import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
	boolean,
	check,
	index,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
	timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date());

// Unconstrained numeric + a `col = round(col, 1)` CHECK: numeric(p,1) would silently round
// 0.15 to 0.2, but more than one decimal must be rejected (FR-005).
const decimal1 = (name: string) => numeric(name, { mode: 'number' });
const oneDecimal = (col: AnyPgColumn) => sql`${col} = round(${col}, 1)`;

// One Member per login provider (FR-051, ADR 0005). Better Auth's own tables live elsewhere.
export const member = pgTable(
	'member',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		provider: text('provider').notNull(),
		providerAccountId: text('provider_account_id').notNull(),
		// Null until the first-login Username setup (FR-052).
		username: text('username'),
		bio: text('bio'),
		iconKey: text('icon_key'),
		isAdministrator: boolean('is_administrator').notNull().default(false),
		suspendedAt: timestamp('suspended_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		unique('member_provider_account_unique').on(t.provider, t.providerAccountId),
		check('member_provider_known', sql`${t.provider} IN ('google', 'line')`), // ADR 0005
		// Case-insensitive so `Alice` cannot impersonate `alice` (FR-053).
		uniqueIndex('member_username_lower_unique').on(sql`lower(${t.username})`),
		check('member_username_format', sql`${t.username} ~ '^[A-Za-z0-9_]{3,20}$'`), // FR-053
		check('member_bio_length', sql`char_length(${t.bio}) <= 200`) // FR-054
	]
);

export const ingredient = pgTable(
	'ingredient',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull().unique(),
		abvPercent: decimal1('abv_percent').notNull(),
		isBaseSpirit: boolean('is_base_spirit').notNull().default(false),
		isAlcoholic: boolean('is_alcoholic')
			.notNull()
			.generatedAlwaysAs(sql`abv_percent > 0`),
		// Null for seed data (DT-001); kept when the creating Member withdraws.
		createdBy: uuid('created_by').references(() => member.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [
		check('ingredient_name_not_blank', sql`char_length(btrim(${t.name})) > 0`),
		check('ingredient_abv_range', sql`${t.abvPercent} BETWEEN 0 AND 100`),
		check('ingredient_abv_one_decimal', oneDecimal(t.abvPercent)),
		// Only alcoholic Ingredients can be a Base (FR-010).
		check('ingredient_base_is_alcoholic', sql`NOT ${t.isBaseSpirit} OR ${t.abvPercent} > 0`)
	]
);

export const recipe = pgTable(
	'recipe',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		memberId: uuid('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }), // FR-058
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		mainPhotoKey: text('main_photo_key').notNull(), // FR-007
		// ADR 0004: derived columns stored and recalculated in the same transaction as their inputs.
		autoAbv: decimal1('auto_abv').notNull().default(0),
		abvOverride: decimal1('abv_override'),
		hasAlcohol: boolean('has_alcohol').notNull().default(false),
		// Denormalised title + description + Ingredient names + step text for keyword search (FR-043).
		searchText: text('search_text').notNull().default(''),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('recipe_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 50`),
		check('recipe_description_length', sql`char_length(${t.description}) <= 500`),
		check('recipe_auto_abv_range', sql`${t.autoAbv} BETWEEN 0 AND 100`),
		check('recipe_auto_abv_one_decimal', oneDecimal(t.autoAbv)),
		check('recipe_abv_override_one_decimal', oneDecimal(t.abvOverride)),
		// FR-024: a Non-alcoholic Recipe is fixed at 0%.
		check('recipe_non_alcoholic_zero', sql`${t.hasAlcohol} OR ${t.autoAbv} = 0`),
		// FR-021/022: the upper bound (highest Ingredient ABV) is enforced in the service layer.
		check(
			'recipe_abv_override_range',
			sql`${t.abvOverride} IS NULL OR (${t.hasAlcohol} AND ${t.abvOverride} > 0 AND ${t.abvOverride} <= 100)`
		),
		index('recipe_member_id_idx').on(t.memberId),
		index('recipe_created_at_idx').on(t.createdAt),
		index('recipe_search_text_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops'))
	]
);

// Extra Photos beyond the Main Photo, at most 3 (FR-003).
export const recipePhoto = pgTable(
	'recipe_photo',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		photoKey: text('photo_key').notNull(),
		position: smallint('position').notNull()
	},
	(t) => [
		unique('recipe_photo_position_unique').on(t.recipeId, t.position),
		check('recipe_photo_position_range', sql`${t.position} BETWEEN 1 AND 3`)
	]
);

export const recipeIngredient = pgTable(
	'recipe_ingredient',
	{
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		ingredientId: uuid('ingredient_id')
			.notNull()
			.references(() => ingredient.id, { onDelete: 'restrict' }),
		mixRatio: decimal1('mix_ratio').notNull(),
		// Display order; the 1..20 range also caps the Ingredient count (FR-004).
		position: smallint('position').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.recipeId, t.ingredientId] }), // no duplicate Ingredient (FR-004)
		unique('recipe_ingredient_position_unique').on(t.recipeId, t.position),
		check('recipe_ingredient_mix_ratio_range', sql`${t.mixRatio} BETWEEN 0.1 AND 99.9`), // FR-005
		check('recipe_ingredient_mix_ratio_one_decimal', oneDecimal(t.mixRatio)),
		check('recipe_ingredient_position_range', sql`${t.position} BETWEEN 1 AND 20`),
		index('recipe_ingredient_ingredient_id_idx').on(t.ingredientId)
	]
);

export const recipeStep = pgTable(
	'recipe_step',
	{
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		position: smallint('position').notNull(),
		text: text('text').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.recipeId, t.position] }),
		check('recipe_step_position_range', sql`${t.position} BETWEEN 1 AND 10`), // FR-006
		check('recipe_step_text_length', sql`char_length(${t.text}) BETWEEN 1 AND 200`)
	]
);

// FR-055: "no Like on own Recipe" is a cross-table rule, enforced in the service layer.
export const like = pgTable(
	'like',
	{
		memberId: uuid('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.memberId, t.recipeId] }),
		index('like_recipe_id_idx').on(t.recipeId)
	]
);

export const save = pgTable(
	'save',
	{
		memberId: uuid('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		recipeId: uuid('recipe_id')
			.notNull()
			.references(() => recipe.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.memberId, t.recipeId] }),
		index('save_recipe_id_idx').on(t.recipeId)
	]
);

export const follow = pgTable(
	'follow',
	{
		followerId: uuid('follower_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		followeeId: uuid('followee_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.followerId, t.followeeId] }),
		check('follow_not_self', sql`${t.followerId} <> ${t.followeeId}`), // FR-057
		index('follow_followee_id_idx').on(t.followeeId)
	]
);

export const reportReason = pgEnum('report_reason', [
	'inappropriate_photo',
	'plagiarism',
	'spam',
	'other'
]);
export const reportStatus = pgEnum('report_status', ['open', 'resolved', 'dismissed']);
// Why a kept Report's recipe link is gone; set by the service in the delete/withdrawal transaction.
export const reportTargetState = pgEnum('report_target_state', [
	'live',
	'recipe_deleted',
	'member_withdrawn'
]);

// Reports outlive their Recipe and reporter (FR-008, FR-074, FR-078), hence the nullable FKs.
export const report = pgTable(
	'report',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
		reporterId: uuid('reporter_id').references(() => member.id, { onDelete: 'set null' }),
		// Author of the Recipe, copied by the service at insert, so repeat offenders stay visible
		// after the Recipe is deleted (FR-073/074). No Recipe content is kept (FR-078).
		reportedMemberId: uuid('reported_member_id').references(() => member.id, {
			onDelete: 'set null'
		}),
		targetState: reportTargetState('target_state').notNull().default('live'),
		reason: reportReason('reason').notNull(),
		detail: text('detail'),
		status: reportStatus('status').notNull().default('open'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		// FR-071. NULLs are distinct, so rows orphaned by deletion never collide.
		unique('report_reporter_recipe_unique').on(t.reporterId, t.recipeId),
		check('report_detail_length', sql`char_length(${t.detail}) <= 200`),
		index('report_status_idx').on(t.status)
	]
);

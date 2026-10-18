import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { requireAdministrator, requireMember } from '#lib/server/auth/guards.js';
import {
	createAlcoholicIngredient,
	createZeroAbvIngredient,
	suggestSimilar,
	updateIngredientAbv
} from '#lib/server/services/ingredients/index.js';
import { isUuid } from '#lib/server/services/recipes/index.js';
import { actorOf, firstValues, invalidRequest, isRecord, statusOf, type ApiEnv } from './http';

type NewIngredient = { name: string; abvPercent: number; isBaseSpirit?: boolean };

function parseNew(v: unknown): NewIngredient | null {
	if (!isRecord(v) || typeof v.name !== 'string' || typeof v.abvPercent !== 'number') return null;
	if (v.isBaseSpirit !== undefined && typeof v.isBaseSpirit !== 'boolean') return null;
	return { name: v.name, abvPercent: v.abvPercent, isBaseSpirit: v.isBaseSpirit };
}

const MAX_SUGGESTIONS = 20;

export const ingredientsRoute = () =>
	new Hono<ApiEnv>()
		// FR-014: similar existing Ingredients, for the registration form.
		.get(
			'/suggest',
			validator('query', (query, c) => {
				const q = firstValues(query);
				const limit = q.limit === undefined ? 5 : Number(q.limit);
				if (!q.name || !Number.isInteger(limit) || limit < 1 || limit > MAX_SUGGESTIONS)
					return invalidRequest(c);
				return { name: q.name, limit };
			}),
			async (c) => {
				const { name, limit } = c.req.valid('query');
				return c.json({ items: await suggestSimilar(name, limit) });
			}
		)
		// FR-012/013: a Member adds 0% Ingredients; alcoholic ones need an Administrator (the service decides).
		.post(
			'/',
			requireMember,
			validator('json', (b, c) => parseNew(b) ?? invalidRequest(c)),
			async (c) => {
				const body = c.req.valid('json');
				const actor = actorOf(c);
				const result =
					body.abvPercent === 0
						? await createZeroAbvIngredient(actor, body)
						: await createAlcoholicIngredient(actor, body);
				if (!result.ok)
					return c.json({ error: result.error, similar: result.similar }, statusOf(result.error));
				return c.json(result.value, 201);
			}
		)
		// FR-015: Administrator edits the ABV; derived Recipe columns are recomputed by the service.
		.patch(
			'/:id/abv',
			requireAdministrator,
			validator('json', (b, c) =>
				isRecord(b) && typeof b.abvPercent === 'number'
					? { abvPercent: b.abvPercent }
					: invalidRequest(c)
			),
			async (c) => {
				const id = c.req.param('id');
				if (!isUuid(id)) return c.json({ error: 'not_found' as const }, 404);
				const result = await updateIngredientAbv(actorOf(c), id, c.req.valid('json').abvPercent);
				if (!result.ok) return c.json({ error: result.error }, statusOf(result.error));
				return c.json(result.value);
			}
		);

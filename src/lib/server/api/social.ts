import { Hono } from 'hono';
import { db } from '#lib/server/db/index.js';
import { requireMember } from '#lib/server/auth/guards.js';
import {
	followMember,
	getProfile,
	getReactions,
	likeRecipe,
	listFollowers,
	listFollowing,
	listMemberRecipes,
	listSavedRecipes,
	saveRecipe,
	unfollowMember,
	unlikeRecipe,
	unsaveRecipe
} from '#lib/server/services/social/index.js';
import { actorOf, statusOf, type ApiEnv } from './http';

const pageOf = (c: { req: { query(k: string): string | undefined } }) => ({
	cursor: c.req.query('cursor') || null
});

/**
 * Like (FR-055), Save (FR-056), Follow (FR-057) and the public profile reads (FR-054). Mounted at
 * the API root because the paths span `/recipes/:id/*`, `/members/:username/*` and `/me/saves`.
 * PUT and DELETE are idempotent.
 */
export const socialRoute = () =>
	new Hono<ApiEnv>()
		// Like count and the viewer's own state; signed-out viewers get liked/saved false.
		.get('/recipes/:id/reactions', async (c) => {
			const r = await getReactions(db, c.req.param('id'), c.env.locals.member?.id ?? null);
			if (!r) return c.json({ error: 'not_found' as const }, 404);
			return c.json(r);
		})
		.put('/recipes/:id/like', requireMember, async (c) => {
			const r = await likeRecipe(db, actorOf(c), c.req.param('id'));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		.delete('/recipes/:id/like', requireMember, async (c) => {
			const r = await unlikeRecipe(db, actorOf(c), c.req.param('id'));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		.put('/recipes/:id/save', requireMember, async (c) => {
			const r = await saveRecipe(db, actorOf(c), c.req.param('id'));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		.delete('/recipes/:id/save', requireMember, async (c) => {
			const r = await unsaveRecipe(db, actorOf(c), c.req.param('id'));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		// FR-056: only ever the signed-in Member's own Saves; there is no route for another Member's.
		.get('/me/saves', requireMember, async (c) =>
			c.json(await listSavedRecipes(db, c.env.locals.member!.id, pageOf(c)))
		)
		.get('/members/:username', async (c) => {
			const p = await getProfile(db, c.req.param('username'), c.env.locals.member?.id ?? null);
			if (!p) return c.json({ error: 'not_found' as const }, 404);
			return c.json(p);
		})
		.get('/members/:username/recipes', async (c) => {
			const p = await getProfile(db, c.req.param('username'), null);
			if (!p) return c.json({ error: 'not_found' as const }, 404);
			return c.json(await listMemberRecipes(db, p.id, pageOf(c)));
		})
		.get('/members/:username/followers', async (c) => {
			const p = await getProfile(db, c.req.param('username'), null);
			if (!p) return c.json({ error: 'not_found' as const }, 404);
			return c.json(await listFollowers(db, p.id, pageOf(c)));
		})
		.get('/members/:username/following', async (c) => {
			const p = await getProfile(db, c.req.param('username'), null);
			if (!p) return c.json({ error: 'not_found' as const }, 404);
			return c.json(await listFollowing(db, p.id, pageOf(c)));
		})
		.put('/members/:username/follow', requireMember, async (c) => {
			const r = await followMember(db, actorOf(c), c.req.param('username'));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		})
		.delete('/members/:username/follow', requireMember, async (c) => {
			const r = await unfollowMember(db, actorOf(c), c.req.param('username'));
			if (!r.ok) return c.json({ error: r.error }, statusOf(r.error));
			return c.json(r.value);
		});

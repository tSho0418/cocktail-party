// How many 0% Ingredients one Member may register (FR-012, #64). Shared by the service that
// enforces it and the messages the form shows; no I/O.

/**
 * Per rolling 24 hours. A Member rarely needs more than a syrup or two for one Recipe, and the
 * seed master (~80) already covers the common 0% ones; five a day leaves room to post a few
 * Recipes in one sitting.
 */
export const MAX_ZERO_ABV_INGREDIENTS_PER_DAY = 5;

/**
 * Per Member, ever. It bounds the master (and so the top page's full Ingredient list and the
 * suggest scan) at about 80 + Members × this: the daily limit alone only slows one account down.
 */
export const MAX_ZERO_ABV_INGREDIENTS_TOTAL = 30;

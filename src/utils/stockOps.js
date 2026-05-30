'use strict';

/**
 * Pure operations over a Live Stock document's `categories` array.
 *
 * A categories value has the shape:
 *   Array<{
 *     name: string,
 *     emoji?: string,
 *     items: Array<{ name: string, quantity: number }>
 *   }>
 *
 * Every function here is dependency-free and never mutates its input — it
 * returns a new categories array (and a decision object describing the
 * outcome). The repository layer persists the returned categories; the command
 * layer turns the decision into a Discord reply.
 */

/**
 * Case-insensitive, whitespace-insensitive string match.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function namesEqual(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Find a category by name (case-insensitive). Returns the category or null.
 * @param {Array} categories
 * @param {string} categoryName
 * @returns {object|null}
 */
function findCategory(categories, categoryName) {
  return categories.find((c) => namesEqual(c.name, categoryName)) || null;
}

/**
 * Find an item within a category by name (case-insensitive).
 * @param {object} category
 * @param {string} itemName
 * @returns {object|null}
 */
function findItem(category, itemName) {
  if (!category || !Array.isArray(category.items)) {
    return null;
  }
  return category.items.find((i) => namesEqual(i.name, itemName)) || null;
}

/** Deep copy a categories array so callers never mutate the input. */
function cloneCategories(categories) {
  return categories.map((c) => ({
    name: c.name,
    emoji: c.emoji,
    items: (c.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
  }));
}

/**
 * Deposit (add) `amount` of an item in a category.
 *
 * @param {Array} categories
 * @param {string} categoryName
 * @param {string} itemName
 * @param {number} amount - positive integer
 * @returns {{ categories: Array, changed: boolean, reason: string, item?: object, category?: object }}
 *   reason ∈ 'ok' | 'invalid_amount' | 'category_not_found' | 'item_not_found'
 */
function deposit(categories, categoryName, itemName, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { categories, changed: false, reason: 'invalid_amount' };
  }
  const next = cloneCategories(categories);
  const category = findCategory(next, categoryName);
  if (!category) {
    return { categories, changed: false, reason: 'category_not_found' };
  }
  const item = findItem(category, itemName);
  if (!item) {
    return { categories, changed: false, reason: 'item_not_found' };
  }
  item.quantity += amount;
  return { categories: next, changed: true, reason: 'ok', item, category };
}

/**
 * Withdraw (subtract) `amount` of an item; refuses when stock is insufficient.
 *
 * @param {Array} categories
 * @param {string} categoryName
 * @param {string} itemName
 * @param {number} amount - positive integer
 * @returns {{ categories: Array, changed: boolean, reason: string, available?: number, item?: object, category?: object }}
 *   reason ∈ 'ok' | 'invalid_amount' | 'category_not_found' | 'item_not_found' | 'insufficient_stock'
 */
function withdraw(categories, categoryName, itemName, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { categories, changed: false, reason: 'invalid_amount' };
  }
  const next = cloneCategories(categories);
  const category = findCategory(next, categoryName);
  if (!category) {
    return { categories, changed: false, reason: 'category_not_found' };
  }
  const item = findItem(category, itemName);
  if (!item) {
    return { categories, changed: false, reason: 'item_not_found' };
  }
  if (item.quantity < amount) {
    return {
      categories,
      changed: false,
      reason: 'insufficient_stock',
      available: item.quantity,
      category,
    };
  }
  item.quantity -= amount;
  return { categories: next, changed: true, reason: 'ok', item, category };
}

/**
 * Add a new (empty) category. No-op reason 'duplicate' if it already exists.
 * @param {Array} categories
 * @param {string} categoryName
 * @param {string} [emoji]
 * @returns {{ categories: Array, changed: boolean, reason: string }}
 */
function addCategory(categories, categoryName, emoji = '') {
  if (findCategory(categories, categoryName)) {
    return { categories, changed: false, reason: 'duplicate' };
  }
  const next = cloneCategories(categories);
  next.push({ name: String(categoryName).trim(), emoji: String(emoji || '').trim(), items: [] });
  return { categories: next, changed: true, reason: 'added' };
}

/**
 * Remove a category by name. reason 'not_found' when absent.
 * @param {Array} categories
 * @param {string} categoryName
 * @returns {{ categories: Array, changed: boolean, reason: string }}
 */
function removeCategory(categories, categoryName) {
  if (!findCategory(categories, categoryName)) {
    return { categories, changed: false, reason: 'not_found' };
  }
  const next = cloneCategories(categories).filter((c) => !namesEqual(c.name, categoryName));
  return { categories: next, changed: true, reason: 'removed' };
}

/**
 * Add an item to a category. reason 'category_not_found' or 'duplicate'.
 * @param {Array} categories
 * @param {string} categoryName
 * @param {string} itemName
 * @param {number} [quantity=0]
 * @returns {{ categories: Array, changed: boolean, reason: string }}
 */
function addItem(categories, categoryName, itemName, quantity = 0) {
  const next = cloneCategories(categories);
  const category = findCategory(next, categoryName);
  if (!category) {
    return { categories, changed: false, reason: 'category_not_found' };
  }
  if (findItem(category, itemName)) {
    return { categories, changed: false, reason: 'duplicate' };
  }
  const qty = Number.isInteger(quantity) && quantity >= 0 ? quantity : 0;
  category.items.push({ name: String(itemName).trim(), quantity: qty });
  return { categories: next, changed: true, reason: 'added' };
}

/**
 * Remove an item from a category. reason 'category_not_found' or 'item_not_found'.
 * @param {Array} categories
 * @param {string} categoryName
 * @param {string} itemName
 * @returns {{ categories: Array, changed: boolean, reason: string }}
 */
function removeItem(categories, categoryName, itemName) {
  const next = cloneCategories(categories);
  const category = findCategory(next, categoryName);
  if (!category) {
    return { categories, changed: false, reason: 'category_not_found' };
  }
  if (!findItem(category, itemName)) {
    return { categories, changed: false, reason: 'item_not_found' };
  }
  category.items = category.items.filter((i) => !namesEqual(i.name, itemName));
  return { categories: next, changed: true, reason: 'removed' };
}

/**
 * Format an integer with '.' as the thousands separator (e.g. 14894829 ->
 * "14.894.829"), matching the operator's example board.
 * @param {number} n
 * @returns {string}
 */
function formatQuantity(n) {
  const value = Number(n) || 0;
  const sign = value < 0 ? '-' : '';
  const digits = Math.abs(Math.trunc(value)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Find every (category, item) pair whose item matches `itemName`
 * (case-insensitive) across all categories. An item name may legitimately
 * appear in more than one category (e.g. "Paket Coccaine"), so this can return
 * multiple locations.
 *
 * @param {Array} categories
 * @param {string} itemName
 * @returns {Array<{ categoryName: string, category: object, item: object }>}
 */
function findItemLocations(categories, itemName) {
  const locations = [];
  for (const category of categories) {
    const item = findItem(category, itemName);
    if (item) {
      locations.push({ categoryName: category.name, category, item });
    }
  }
  return locations;
}

/**
 * Smart deposit used by `/dp <jumlah> <item> [kategori]`.
 *
 * Behaviour:
 *   - If `categoryName` is given: the item is placed in (or created in) that
 *     exact category. This is how brand-new items get a home.
 *   - If `categoryName` is omitted: the item must already exist. When it exists
 *     in exactly one category it is topped up there; when it exists in several
 *     categories the result is `ambiguous`; when it does not exist at all the
 *     result is `need_category`.
 *
 * @param {Array} categories
 * @param {string} itemName
 * @param {number} amount - positive integer
 * @param {string} [categoryName]
 * @returns {{ categories: Array, changed: boolean, reason: string, item?: object, category?: object, options?: string[] }}
 *   reason ∈ 'ok' | 'created' | 'invalid_amount' | 'category_not_found' | 'need_category' | 'ambiguous'
 */
function depositSmart(categories, itemName, amount, categoryName) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { categories, changed: false, reason: 'invalid_amount' };
  }
  const cleanItem = String(itemName).trim();

  if (categoryName && String(categoryName).trim() !== '') {
    const next = cloneCategories(categories);
    let category = findCategory(next, categoryName);
    let categoryCreated = false;
    if (!category) {
      // Auto-create the category when an approver/member types a new one on /dp.
      category = { name: String(categoryName).trim(), emoji: '', items: [] };
      next.push(category);
      categoryCreated = true;
    }
    const existing = findItem(category, cleanItem);
    if (existing) {
      existing.quantity += amount;
      return { categories: next, changed: true, reason: 'ok', item: existing, category, categoryCreated };
    }
    const created = { name: cleanItem, quantity: amount };
    category.items.push(created);
    return { categories: next, changed: true, reason: 'created', item: created, category, categoryCreated };
  }

  // No category supplied: rely on the item already existing.
  const locations = findItemLocations(categories, cleanItem);
  if (locations.length === 0) {
    return { categories, changed: false, reason: 'need_category' };
  }
  if (locations.length > 1) {
    return {
      categories,
      changed: false,
      reason: 'ambiguous',
      options: locations.map((l) => l.categoryName),
    };
  }
  const next = cloneCategories(categories);
  const category = findCategory(next, locations[0].categoryName);
  const item = findItem(category, cleanItem);
  item.quantity += amount;
  return { categories: next, changed: true, reason: 'ok', item, category };
}

/**
 * Smart withdraw used by `/wd <jumlah> <item> [kategori]`.
 *
 * Behaviour:
 *   - If `categoryName` is given it is used directly (disambiguation).
 *   - Otherwise the item is matched across all categories: a unique match is
 *     withdrawn from; zero matches → `item_not_found`; multiple matches →
 *     `ambiguous` (the caller should ask which category).
 * Insufficient stock is always refused.
 *
 * @param {Array} categories
 * @param {string} itemName
 * @param {number} amount - positive integer
 * @param {string} [categoryName]
 * @returns {{ categories: Array, changed: boolean, reason: string, item?: object, category?: object, available?: number, options?: string[] }}
 *   reason ∈ 'ok' | 'invalid_amount' | 'item_not_found' | 'category_not_found' | 'insufficient_stock' | 'ambiguous'
 */
function withdrawSmart(categories, itemName, amount, categoryName) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { categories, changed: false, reason: 'invalid_amount' };
  }
  const cleanItem = String(itemName).trim();

  let targetCategoryName;
  if (categoryName && String(categoryName).trim() !== '') {
    const category = findCategory(categories, categoryName);
    if (!category) {
      return { categories, changed: false, reason: 'category_not_found' };
    }
    if (!findItem(category, cleanItem)) {
      return { categories, changed: false, reason: 'item_not_found' };
    }
    targetCategoryName = category.name;
  } else {
    const locations = findItemLocations(categories, cleanItem);
    if (locations.length === 0) {
      return { categories, changed: false, reason: 'item_not_found' };
    }
    if (locations.length > 1) {
      return {
        categories,
        changed: false,
        reason: 'ambiguous',
        options: locations.map((l) => l.categoryName),
      };
    }
    targetCategoryName = locations[0].categoryName;
  }

  const next = cloneCategories(categories);
  const category = findCategory(next, targetCategoryName);
  const item = findItem(category, cleanItem);
  if (item.quantity < amount) {
    return { categories, changed: false, reason: 'insufficient_stock', available: item.quantity, category };
  }
  item.quantity -= amount;
  return { categories: next, changed: true, reason: 'ok', item, category };
}

module.exports = {
  namesEqual,
  findCategory,
  findItem,
  findItemLocations,
  cloneCategories,
  deposit,
  withdraw,
  depositSmart,
  withdrawSmart,
  addCategory,
  removeCategory,
  addItem,
  removeItem,
  formatQuantity,
};

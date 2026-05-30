'use strict';

const ops = require('../src/utils/stockOps');

/**
 * Unit tests for the pure stock operations (src/utils/stockOps.js).
 *
 * These cover deposit/withdraw outcomes (including insufficient stock and
 * not-found cases), category/item management, immutability of inputs, and the
 * thousands-separator number formatter.
 */

function sampleCategories() {
  return [
    {
      name: 'Alat Rampok',
      emoji: '🦹',
      items: [
        { name: 'Drill', quantity: 8 },
        { name: 'C4 Bomb', quantity: 10 },
      ],
    },
    {
      name: 'Keuangan',
      emoji: '💰',
      items: [{ name: 'Uang Merah', quantity: 1000 }],
    },
  ];
}

describe('formatQuantity', () => {
  it('inserts dot thousands separators', () => {
    expect(ops.formatQuantity(0)).toBe('0');
    expect(ops.formatQuantity(999)).toBe('999');
    expect(ops.formatQuantity(1000)).toBe('1.000');
    expect(ops.formatQuantity(14894829)).toBe('14.894.829');
  });

  it('scales to millions, hundreds of millions, and billions', () => {
    expect(ops.formatQuantity(1000000)).toBe('1.000.000');
    expect(ops.formatQuantity(123456789)).toBe('123.456.789');
    expect(ops.formatQuantity(1000000000)).toBe('1.000.000.000');
  });

  it('handles negatives and non-numbers safely', () => {
    expect(ops.formatQuantity(-1500)).toBe('-1.500');
    expect(ops.formatQuantity(undefined)).toBe('0');
  });
});

describe('deposit', () => {
  it('adds to an existing item without mutating the input', () => {
    const cats = sampleCategories();
    const result = ops.deposit(cats, 'Alat Rampok', 'Drill', 5);
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.item.quantity).toBe(13);
    // input untouched
    expect(cats[0].items[0].quantity).toBe(8);
  });

  it('is case-insensitive on category and item names', () => {
    const result = ops.deposit(sampleCategories(), 'alat rampok', 'drill', 2);
    expect(result.changed).toBe(true);
    expect(result.item.quantity).toBe(10);
  });

  it('rejects invalid amounts', () => {
    expect(ops.deposit(sampleCategories(), 'Keuangan', 'Uang Merah', 0).reason).toBe(
      'invalid_amount',
    );
    expect(ops.deposit(sampleCategories(), 'Keuangan', 'Uang Merah', -3).reason).toBe(
      'invalid_amount',
    );
    expect(ops.deposit(sampleCategories(), 'Keuangan', 'Uang Merah', 1.5).reason).toBe(
      'invalid_amount',
    );
  });

  it('reports not-found for unknown category/item', () => {
    expect(ops.deposit(sampleCategories(), 'Nope', 'Drill', 1).reason).toBe('category_not_found');
    expect(ops.deposit(sampleCategories(), 'Alat Rampok', 'Nope', 1).reason).toBe('item_not_found');
  });
});

describe('withdraw', () => {
  it('subtracts when enough stock exists', () => {
    const cats = sampleCategories();
    const result = ops.withdraw(cats, 'Alat Rampok', 'Drill', 3);
    expect(result.changed).toBe(true);
    expect(result.item.quantity).toBe(5);
    expect(cats[0].items[0].quantity).toBe(8); // input untouched
  });

  it('refuses when stock is insufficient and reports availability', () => {
    const result = ops.withdraw(sampleCategories(), 'Alat Rampok', 'Drill', 200);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('insufficient_stock');
    expect(result.available).toBe(8);
  });

  it('allows withdrawing exactly the available amount (to zero)', () => {
    const result = ops.withdraw(sampleCategories(), 'Alat Rampok', 'Drill', 8);
    expect(result.changed).toBe(true);
    expect(result.item.quantity).toBe(0);
  });

  it('rejects invalid amounts and unknown targets', () => {
    expect(ops.withdraw(sampleCategories(), 'Alat Rampok', 'Drill', 0).reason).toBe(
      'invalid_amount',
    );
    expect(ops.withdraw(sampleCategories(), 'Nope', 'Drill', 1).reason).toBe('category_not_found');
    expect(ops.withdraw(sampleCategories(), 'Alat Rampok', 'Nope', 1).reason).toBe(
      'item_not_found',
    );
  });
});

describe('depositSmart', () => {
  it('creates a brand-new item when a category is given', () => {
    const cats = sampleCategories();
    const result = ops.depositSmart(cats, 'Nail Gun', 200, 'Alat Rampok');
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('created');
    const cat = result.categories.find((c) => c.name === 'Alat Rampok');
    expect(cat.items.find((i) => i.name === 'Nail Gun').quantity).toBe(200);
  });

  it('tops up an existing item without a category (auto-match, case-insensitive)', () => {
    const result = ops.depositSmart(sampleCategories(), 'DRILL', 2);
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.item.quantity).toBe(10);
  });

  it('asks for a category when a brand-new item has none', () => {
    const result = ops.depositSmart(sampleCategories(), 'Nail Gun', 5);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('need_category');
  });

  it('auto-creates the category when a new category name is given', () => {
    const cats = sampleCategories();
    const result = ops.depositSmart(cats, 'Repair Kit', 7, 'Utils');
    expect(result.changed).toBe(true);
    expect(result.categoryCreated).toBe(true);
    const cat = result.categories.find((c) => c.name === 'Utils');
    expect(cat).toBeDefined();
    expect(cat.items.find((i) => i.name === 'Repair Kit').quantity).toBe(7);
    // input untouched
    expect(cats.some((c) => c.name === 'Utils')).toBe(false);
  });

  it('does not flag categoryCreated when depositing into an existing category', () => {
    const result = ops.depositSmart(sampleCategories(), 'Drill', 2, 'Alat Rampok');
    expect(result.changed).toBe(true);
    expect(result.categoryCreated).toBeFalsy();
  });

  it('is ambiguous when the item exists in multiple categories and no category given', () => {
    const cats = [
      { name: 'Perlengkapan', items: [{ name: 'Paket Coccaine', quantity: 1 }] },
      { name: 'Crafting', items: [{ name: 'Paket Coccaine', quantity: 2 }] },
    ];
    const result = ops.depositSmart(cats, 'paket coccaine', 5);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('ambiguous');
    expect(result.options).toEqual(expect.arrayContaining(['Perlengkapan', 'Crafting']));
  });
});

describe('withdrawSmart', () => {
  it('auto-matches the category when unique and subtracts', () => {
    const result = ops.withdrawSmart(sampleCategories(), 'drill', 3);
    expect(result.changed).toBe(true);
    expect(result.item.quantity).toBe(5);
    expect(result.category.name).toBe('Alat Rampok');
  });

  it('refuses when insufficient even with auto-match', () => {
    const result = ops.withdrawSmart(sampleCategories(), 'Drill', 999);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('insufficient_stock');
    expect(result.available).toBe(8);
  });

  it('reports item_not_found for an unknown item', () => {
    expect(ops.withdrawSmart(sampleCategories(), 'Nope', 1).reason).toBe('item_not_found');
  });

  it('is ambiguous across multiple categories without a category hint', () => {
    const cats = [
      { name: 'Perlengkapan', items: [{ name: 'Paket Coccaine', quantity: 5 }] },
      { name: 'Crafting', items: [{ name: 'Paket Coccaine', quantity: 9 }] },
    ];
    const result = ops.withdrawSmart(cats, 'Paket Coccaine', 1);
    expect(result.reason).toBe('ambiguous');
  });

  it('uses the supplied category to disambiguate', () => {
    const cats = [
      { name: 'Perlengkapan', items: [{ name: 'Paket Coccaine', quantity: 5 }] },
      { name: 'Crafting', items: [{ name: 'Paket Coccaine', quantity: 9 }] },
    ];
    const result = ops.withdrawSmart(cats, 'Paket Coccaine', 4, 'Crafting');
    expect(result.changed).toBe(true);
    expect(result.category.name).toBe('Crafting');
    expect(result.item.quantity).toBe(5);
  });
});

describe('findItemLocations', () => {
  it('finds all categories containing a matching item name', () => {
    const cats = [
      { name: 'A', items: [{ name: 'X', quantity: 1 }] },
      { name: 'B', items: [{ name: 'x', quantity: 2 }] },
      { name: 'C', items: [{ name: 'Y', quantity: 3 }] },
    ];
    const locations = ops.findItemLocations(cats, 'X');
    expect(locations.map((l) => l.categoryName)).toEqual(['A', 'B']);
  });
});

describe('category management', () => {
  it('adds and refuses duplicate categories', () => {
    const cats = sampleCategories();
    const added = ops.addCategory(cats, 'Senjata', '⚔️');
    expect(added.changed).toBe(true);
    expect(added.categories.some((c) => c.name === 'Senjata')).toBe(true);

    const dup = ops.addCategory(added.categories, 'senjata');
    expect(dup.changed).toBe(false);
    expect(dup.reason).toBe('duplicate');
  });

  it('removes a category and reports not-found otherwise', () => {
    const removed = ops.removeCategory(sampleCategories(), 'Keuangan');
    expect(removed.changed).toBe(true);
    expect(removed.categories.some((c) => c.name === 'Keuangan')).toBe(false);

    expect(ops.removeCategory(sampleCategories(), 'Nope').reason).toBe('not_found');
  });
});

describe('item management', () => {
  it('adds an item, refuses duplicates and unknown categories', () => {
    const cats = sampleCategories();
    const added = ops.addItem(cats, 'Keuangan', 'Uang Hitam', 50);
    expect(added.changed).toBe(true);
    const cat = added.categories.find((c) => c.name === 'Keuangan');
    expect(cat.items.find((i) => i.name === 'Uang Hitam').quantity).toBe(50);

    expect(ops.addItem(added.categories, 'Keuangan', 'uang hitam').reason).toBe('duplicate');
    expect(ops.addItem(cats, 'Nope', 'X').reason).toBe('category_not_found');
  });

  it('removes an item and reports not-found cases', () => {
    const removed = ops.removeItem(sampleCategories(), 'Alat Rampok', 'Drill');
    expect(removed.changed).toBe(true);
    const cat = removed.categories.find((c) => c.name === 'Alat Rampok');
    expect(cat.items.some((i) => i.name === 'Drill')).toBe(false);

    expect(ops.removeItem(sampleCategories(), 'Nope', 'Drill').reason).toBe('category_not_found');
    expect(ops.removeItem(sampleCategories(), 'Alat Rampok', 'Nope').reason).toBe('item_not_found');
  });
});

/* Regression tests for utils/shipping.js — the shipping fields shared by
   marketplace orders (routes/orders.js) and the CNote shop (routes/shop.js). */
const test = require('node:test');
const assert = require('node:assert');
const { parseShipping, SHIPPING_PRICE } = require('../utils/shipping');

const base = { recipient_first_name: ' Ana ', recipient_last_name: 'Pop', recipient_phone: '0700000000' };

test('address delivery needs county, city and address', () => {
    assert.ok(parseShipping({ ...base, delivery_method: 'address' }).error);
    const r = parseShipping({ ...base, delivery_method: 'address', county: 'Cluj', city: 'Cluj-Napoca', address: 'Str. X 1' });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.data.recipient_name, 'Ana Pop');
    assert.strictEqual(r.data.shipping_price, SHIPPING_PRICE.address);
});

test('easybox delivery needs a locker', () => {
    assert.ok(parseShipping({ ...base, delivery_method: 'easybox' }).error);
    const r = parseShipping({ ...base, delivery_method: 'easybox', easybox_name: 'Easybox Kaufland' });
    assert.strictEqual(r.data.shipping_price, SHIPPING_PRICE.easybox);
});

test('rejects unknown methods, missing names and bad emails', () => {
    assert.ok(parseShipping({ ...base, delivery_method: 'drone' }).error);
    assert.ok(parseShipping({ delivery_method: 'easybox', easybox_name: 'X' }).error);
    assert.ok(parseShipping({ ...base, delivery_method: 'easybox', easybox_name: 'X', recipient_email: 'nope' }).error);
});

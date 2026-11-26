/* ─────────────────────────────────────────
   FILE: shipping.js
   DESCRIPTION: Sameday shipping data of a no-payment checkout, shared by the
   marketplace orders (routes/orders.js) and the CNote shop (routes/shop.js).
   Delivery to an address or to an Easybox locker, flat fee per method (no
   live Sameday API - the seller creates the AWB by hand).
   ───────────────────────────────────────── */

const VALID_METHODS = ['address', 'easybox'];
// Flat shipping fee by method, matching Sameday's own current pricing.
const SHIPPING_PRICE = { address: 25, easybox: 20 };

/**
 * Validates and trims the shipping fields of a request body.
 * Returns { error } (a message for a 400) or { data } with every field
 * normalized, `recipient_name` = "first last" and `shipping_price` set.
 */
function parseShipping(body) {
    const b = body || {};
    if (!VALID_METHODS.includes(b.delivery_method)) return { error: 'Invalid delivery method.' };

    const s = (v, n) => String(v || '').trim().slice(0, n);
    const data = {
        delivery_method: b.delivery_method,
        recipient_first_name: s(b.recipient_first_name, 100),
        recipient_last_name: s(b.recipient_last_name, 100),
        recipient_phone: s(b.recipient_phone, 30),
        recipient_email: s(b.recipient_email, 150),
        county: s(b.county, 100),
        city: s(b.city, 100),
        address: s(b.address, 300),
        address_line2: s(b.address_line2, 150),
        easybox_name: s(b.easybox_name, 200),
        notes: s(b.notes, 500),
    };
    data.recipient_name = `${data.recipient_first_name} ${data.recipient_last_name}`.trim();

    if (!data.recipient_first_name || !data.recipient_last_name || !data.recipient_phone) {
        return { error: 'First name, last name and phone are required.' };
    }
    if (data.recipient_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.recipient_email)) {
        return { error: 'Invalid email.' };
    }
    if (data.delivery_method === 'address' && (!data.county || !data.city || !data.address)) {
        return { error: 'County, city and address are required for address delivery.' };
    }
    if (data.delivery_method === 'easybox' && !data.easybox_name) {
        return { error: 'Easybox location is required.' };
    }
    data.shipping_price = SHIPPING_PRICE[data.delivery_method];
    return { data };
}

module.exports = { VALID_METHODS, SHIPPING_PRICE, parseShipping };

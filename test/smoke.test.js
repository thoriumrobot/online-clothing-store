// Smoke test: loads index.html in jsdom, runs main.js, and simulates
// a full shopping journey ending in a successful e-wallet payment.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const productsJs = fs.readFileSync(path.join(root, 'scripts', 'products.js'), 'utf8');
const js = productsJs + '\n' + fs.readFileSync(path.join(root, 'scripts', 'main.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
}
const txt = (sel) => document.querySelector(sel).textContent.trim();

// Run the site script, then fire DOMContentLoaded (jsdom stays in "loading" here)
window.eval(js);
document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

console.log('\n[1] Initial render');
check('5 products rendered', document.querySelectorAll('.product-item').length === 5);
check('cart badge hidden when empty', document.querySelector('#cartCount').hidden === true);
check('checkout button disabled when empty', document.querySelector('#checkoutBtn').disabled === true);

console.log('\n[2] Category filter + search');
document.querySelector('[data-filter="accessories"]').click();
check('accessories filter shows 1 item', document.querySelectorAll('.product-item').length === 1);
document.querySelector('[data-filter="all"]').click();
const si = document.querySelector('#searchInput');
si.value = 'hoodie';
si.dispatchEvent(new window.Event('input', { bubbles: true }));
check('search "hoodie" shows 1 item', document.querySelectorAll('.product-item').length === 1);
si.value = 'zzz';
si.dispatchEvent(new window.Event('input', { bubbles: true }));
check('no-results message appears', document.querySelector('#emptyResults').hidden === false);
si.value = '';
si.dispatchEvent(new window.Event('input', { bubbles: true }));

console.log('\n[3] Cart operations');
const cards = document.querySelectorAll('.product-item');
// Add Everyday Tee (1299) twice and Straight Trousers (2899) once
cards[0].querySelector('.add-btn').click();
cards[0].querySelector('.add-btn').click();
cards[1].querySelector('.add-btn').click();
check('badge shows 3 items', txt('#cartCount') === '3');
check('subtotal = ₱5,497.00', txt('#cartSubtotal') === '₱5,497.00');
check('flat ₱150 shipping applies', txt('#cartShipping') === '₱150.00');
check('total = ₱5,647.00', txt('#cartTotal') === '₱5,647.00');

// Decrease Everyday Tee to 1 → subtotal 4198
document.querySelector('.cart-item [data-act="dec"]').click();
check('qty decrease → subtotal ₱4,198.00', txt('#cartSubtotal') === '₱4,198.00');
// Remove the tee → subtotal 49.00, below threshold → shipping 5.99
document.querySelectorAll('.cart-item [data-act="rm"]')[1].click();
check('remove line → subtotal ₱1,299.00', txt('#cartSubtotal') === '₱1,299.00');
check('shipping ₱150.00 under threshold', txt('#cartShipping') === '₱150.00');
check('total = ₱1,449.00', txt('#cartTotal') === '₱1,449.00');

console.log('\n[4] Size selection routes into cart');
const sized = document.querySelectorAll('.product-item')[2]; // District Hoodie
sized.querySelector('[data-size="L"]').click();
sized.querySelector('.add-btn').click();
check('cart line records chosen size L',
  [...document.querySelectorAll('.cart-item-info p')].some((p) => p.textContent.includes('Size L')));
document.querySelectorAll('.cart-item [data-act="rm"]')[1].click(); // remove hoodie again

console.log('\n[5] Checkout validation (GCash default)');
window.SAAK_CONFIG.qrPh = 'images/tee.svg'; // owner configured a QR code
document.querySelector('#checkoutBtn').click();
check('checkout modal opens', document.querySelector('#checkoutModal').hidden === false);
check('summary shows total due', txt('#checkoutSummary').includes('\u20b11,449.00'));
check('GCash is the default method', document.querySelector('#fieldsGcash').hidden === false);
check('configured GCash number shown', txt('#gcashNumber') === '+639305314317');
check('QR Ph code shown when configured', document.querySelector('#qrBoxGcash').hidden === false
  && document.querySelector('#qrImgGcash').src.includes('images/tee.svg'));
check('pay button states the sent amount', txt('#payBtn').includes('\u20b11,449.00'));
document.querySelector('#payBtn').click();
check('blocks empty delivery details', document.querySelector('#checkoutError').hidden === false);

document.querySelector('#shipName').value = 'Alex Reyes';
document.querySelector('#shipEmail').value = 'alex@example.com';
document.querySelector('#shipAddress').value = '12 Mabini Street';
document.querySelector('#shipRegion').value = 'Metro Manila';
document.querySelector('#shipZip').value = '1600';
document.querySelector('#payBtn').click();
check('blocks missing GCash reference', txt('#checkoutError').includes('13-digit'));
document.querySelector('#gcashRef').value = '12345';
document.querySelector('#payBtn').click();
check('blocks short GCash reference', txt('#checkoutError').includes('13-digit'));

console.log('\n[6] GCash manual-transfer order succeeds');
// stub the optional order log endpoint
let logged = null;
window.SAAK_CONFIG.orderLogUrl = 'https://log.test/orders';
window.fetch = (url, opts) => { logged = { url, body: JSON.parse(opts.body) }; return Promise.resolve({ ok: true }); };
document.querySelector('#gcashRef').value = '1234567890123';
document.querySelector('#payBtn').click();
check('processing step shown', document.querySelector('#processingStep').hidden === false);
document.querySelector('#modalClose').click(); // must NOT close mid-payment
check('modal cannot be closed while recording the order', document.querySelector('#checkoutModal').hidden === false);

setTimeout(() => {
  check('success step shown', document.querySelector('#successStep').hidden === false);
  check('receipt has SAAK order id', txt('#receipt').includes('SAAK-'));
  check('receipt shows GCash method', txt('#receipt').includes('GCash'));
  check('receipt shows payment reference', txt('#receipt').includes('1234567890123'));
  check('verification-first copy (no false paid claim)', txt('#successDetail').includes('verified'));
  const mail = document.querySelector('#orderEmailBtn').href;
  check('order email goes to configured store address', mail.startsWith('mailto:orders@saak-store.example'));
  const body = decodeURIComponent(mail);
  check('order email lists the item', body.includes('Everyday Tee'));
  check('order email carries the delivery address', body.includes('12 Mabini Street') && body.includes('Metro Manila'));
  check('order email carries the payment reference', body.includes('ref 1234567890123'));
  check('cart cleared after order', document.querySelector('#cartCount').hidden === true);
  check('cart persisted to localStorage', window.localStorage.getItem('saak_cart') === '[]');
  check('payment reference cleared for the next order', document.querySelector('#gcashRef').value === '');
  check('order log POSTed to configured URL', logged !== null && logged.url === 'https://log.test/orders');
  check('log payload has order id + method + reference', logged.body.orderId.startsWith('SAAK-') && logged.body.method.includes('GCash') && logged.body.reference === '1234567890123');
  check('log payload itemizes the cart', logged.body.items.length === 1 && logged.body.items[0].name === 'Everyday Tee' && logged.body.total === 1449);
  check('log payload carries the delivery address', logged.body.address.includes('12 Mabini Street'));
  document.querySelector('#doneBtn').click();
  check('modal closes normally after completion', document.querySelector('#checkoutModal').hidden === true);

  console.log('\n[7] Bank transfer (InstaPay) path');
  const dom2 = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom2.window.eval(js);
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  const d2 = dom2.window.document;
  d2.querySelectorAll('.product-item')[0].querySelector('.buy-btn').click(); // \u20b11,299 + \u20b1150 ship
  check('buy-now opens checkout directly', d2.querySelector('#checkoutModal').hidden === false);
  check('only GCash and bank methods offered', d2.querySelectorAll('.pay-method').length === 2);
  check('QR hidden when not configured', d2.querySelector('#qrBoxGcash').hidden === true && d2.querySelector('#qrBoxBank').hidden === true);

  d2.querySelector('[data-method="bank"]').click();
  check('bank fields revealed', d2.querySelector('#fieldsBank').hidden === false && d2.querySelector('#fieldsGcash').hidden === true);
  check('configured bank account shown', d2.querySelector('#bankNumber').textContent === '1234 5678 90' && d2.querySelector('#bankName').textContent === 'BPI');
  check('total is flat ₱1,449.00', d2.querySelector('#checkoutSummary').textContent.includes('\u20b11,449.00'));
  d2.querySelector('#shipName').value = 'B Cruz'; d2.querySelector('#shipEmail').value = 'b@x.ph';
  d2.querySelector('#shipAddress').value = '7 Rizal Ave'; d2.querySelector('#shipRegion').value = 'Central Visayas'; d2.querySelector('#shipZip').value = '6000';
  d2.querySelector('#bankRef').value = 'AB1';
  d2.querySelector('#payBtn').click();
  check('blocks too-short bank reference', d2.querySelector('#checkoutError').hidden === false);
  d2.querySelector('#bankRef').value = 'INSTA-2026-0001';
  d2.querySelector('#payBtn').click();

  setTimeout(() => {
    check('bank order succeeds', d2.querySelector('#successStep').hidden === false);
    check('receipt shows bank method + reference', d2.querySelector('#receipt').textContent.includes('Bank transfer (InstaPay)') && d2.querySelector('#receipt').textContent.includes('INSTA-2026-0001'));
    check('verification-first copy', d2.querySelector('#successDetail').textContent.includes('verified'));
    console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }, 1800);
}, 1800);

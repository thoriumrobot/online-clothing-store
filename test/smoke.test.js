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
check('9 products rendered', document.querySelectorAll('.product-item').length === 9);
check('cart badge hidden when empty', document.querySelector('#cartCount').hidden === true);
check('checkout button disabled when empty', document.querySelector('#checkoutBtn').disabled === true);

console.log('\n[2] Category filter + search');
document.querySelector('[data-filter="accessories"]').click();
check('accessories filter shows 3 items', document.querySelectorAll('.product-item').length === 3);
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
// Add "Studio Knit" ($49) twice and "Everyday Tee" ($29.99) once
cards[0].querySelector('.add-btn').click();
cards[0].querySelector('.add-btn').click();
cards[1].querySelector('.add-btn').click();
check('badge shows 3 items', txt('#cartCount') === '3');
check('subtotal = ₱6,297.00', txt('#cartSubtotal') === '₱6,297.00');
check('free shipping over ₱2,500', txt('#cartShipping') === 'Free');
check('total = ₱6,297.00', txt('#cartTotal') === '₱6,297.00');

// Decrease Studio Knit to 1 → subtotal 78.99, still free shipping
document.querySelector('.cart-item [data-act="dec"]').click();
check('qty decrease → subtotal ₱3,798.00', txt('#cartSubtotal') === '₱3,798.00');
// Remove the tee → subtotal 49.00, below threshold → shipping 5.99
document.querySelectorAll('.cart-item [data-act="rm"]')[1].click();
check('remove line → subtotal ₱2,499.00', txt('#cartSubtotal') === '₱2,499.00');
check('shipping ₱150.00 under threshold', txt('#cartShipping') === '₱150.00');
check('total = ₱2,649.00', txt('#cartTotal') === '₱2,649.00');

console.log('\n[4] Size selection routes into cart');
const sized = document.querySelectorAll('.product-item')[2]; // District Hoodie
sized.querySelector('[data-size="L"]').click();
sized.querySelector('.add-btn').click();
check('cart line records chosen size L',
  [...document.querySelectorAll('.cart-item-info p')].some((p) => p.textContent.includes('Size L')));
document.querySelectorAll('.cart-item [data-act="rm"]')[1].click(); // remove hoodie again

console.log('\n[5] Checkout validation (GCash default)');
document.querySelector('#checkoutBtn').click();
check('checkout modal opens', document.querySelector('#checkoutModal').hidden === false);
check('summary shows total due', txt('#checkoutSummary').includes('\u20b12,649.00'));
check('GCash is the default method', document.querySelector('#fieldsGcash').hidden === false);
check('configured GCash number shown', txt('#gcashNumber') === '0917 000 0000');
check('pay button states the sent amount', txt('#payBtn').includes('\u20b12,649.00'));
document.querySelector('#payBtn').click();
check('blocks empty delivery details', document.querySelector('#checkoutError').hidden === false);

document.querySelector('#shipName').value = 'Alex Reyes';
document.querySelector('#shipEmail').value = 'alex@example.com';
document.querySelector('#shipAddress').value = '12 Mabini Street';
document.querySelector('#shipCity').value = 'Pasig';
document.querySelector('#shipZip').value = '1600';
document.querySelector('#payBtn').click();
check('blocks missing GCash reference', txt('#checkoutError').includes('13-digit'));
document.querySelector('#gcashRef').value = '12345';
document.querySelector('#payBtn').click();
check('blocks short GCash reference', txt('#checkoutError').includes('13-digit'));

console.log('\n[6] GCash manual-transfer order succeeds');
document.querySelector('#gcashRef').value = '1234567890123';
document.querySelector('#payBtn').click();
check('processing step shown', document.querySelector('#processingStep').hidden === false);

setTimeout(() => {
  check('success step shown', document.querySelector('#successStep').hidden === false);
  check('receipt has SAAK order id', txt('#receipt').includes('SAAK-'));
  check('receipt shows GCash method', txt('#receipt').includes('GCash'));
  check('receipt shows payment reference', txt('#receipt').includes('1234567890123'));
  check('verification-first copy (no false paid claim)', txt('#successDetail').includes('verified'));
  const mail = document.querySelector('#orderEmailBtn').href;
  check('order email goes to configured store address', mail.startsWith('mailto:orders@saak-store.example'));
  const body = decodeURIComponent(mail);
  check('order email lists the item', body.includes('Studio Knit'));
  check('order email carries the delivery address', body.includes('12 Mabini Street') && body.includes('Pasig'));
  check('order email carries the payment reference', body.includes('ref 1234567890123'));
  check('cart cleared after order', document.querySelector('#cartCount').hidden === true);
  check('cart persisted to localStorage', window.localStorage.getItem('saak_cart') === '[]');

  console.log('\n[7] Maya and COD paths');
  const dom2 = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom2.window.eval(js);
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  const d2 = dom2.window.document;
  d2.querySelectorAll('.product-item')[0].querySelector('.buy-btn').click(); // \u20b12,499 + \u20b1150 ship
  check('buy-now opens checkout directly', d2.querySelector('#checkoutModal').hidden === false);

  d2.querySelector('[data-method="cod"]').click();
  check('COD adds \u20b150.00 fee to total', d2.querySelector('#checkoutSummary').textContent.includes('\u20b12,699.00'));
  check('COD button says Place order', d2.querySelector('#payBtn').textContent === 'Place order');

  d2.querySelector('[data-method="maya"]').click();
  check('Maya fields revealed', d2.querySelector('#fieldsMaya').hidden === false && d2.querySelector('#fieldsGcash').hidden === true);
  check('Maya total drops COD fee', d2.querySelector('#checkoutSummary').textContent.includes('\u20b12,649.00'));
  d2.querySelector('#shipName').value = 'B Cruz'; d2.querySelector('#shipEmail').value = 'b@x.ph';
  d2.querySelector('#shipAddress').value = '7 Rizal Ave'; d2.querySelector('#shipCity').value = 'Cebu'; d2.querySelector('#shipZip').value = '6000';
  d2.querySelector('#mayaRef').value = 'MY';
  d2.querySelector('#payBtn').click();
  check('blocks too-short Maya reference', d2.querySelector('#checkoutError').hidden === false);
  d2.querySelector('#mayaRef').value = 'MAYA12345678';
  d2.querySelector('#payBtn').click();

  setTimeout(() => {
    check('Maya order succeeds', d2.querySelector('#successStep').hidden === false);
    check('receipt shows Maya + reference', d2.querySelector('#receipt').textContent.includes('Maya') && d2.querySelector('#receipt').textContent.includes('MAYA12345678'));
    console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }, 1800);
}, 1800);

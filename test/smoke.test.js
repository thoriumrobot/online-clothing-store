// Smoke test: loads index.html in jsdom, runs main.js, and simulates
// a full shopping journey ending in a successful e-wallet payment.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'scripts', 'main.js'), 'utf8');

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
check('subtotal = $127.99', txt('#cartSubtotal') === '$127.99');
check('free shipping over $75', txt('#cartShipping') === 'Free');
check('total = $127.99', txt('#cartTotal') === '$127.99');

// Decrease Studio Knit to 1 → subtotal 78.99, still free shipping
document.querySelector('.cart-item [data-act="dec"]').click();
check('qty decrease → subtotal $78.99', txt('#cartSubtotal') === '$78.99');
// Remove the tee → subtotal 49.00, below threshold → shipping 5.99
document.querySelectorAll('.cart-item [data-act="rm"]')[1].click();
check('remove line → subtotal $49.00', txt('#cartSubtotal') === '$49.00');
check('shipping $5.99 under threshold', txt('#cartShipping') === '$5.99');
check('total = $54.99', txt('#cartTotal') === '$54.99');

console.log('\n[4] Size selection routes into cart');
const sized = document.querySelectorAll('.product-item')[2]; // District Hoodie
sized.querySelector('[data-size="L"]').click();
sized.querySelector('.add-btn').click();
check('cart line records chosen size L',
  [...document.querySelectorAll('.cart-item-info p')].some((p) => p.textContent.includes('Size L')));
document.querySelectorAll('.cart-item [data-act="rm"]')[1].click(); // remove hoodie again

console.log('\n[5] Checkout validation');
document.querySelector('#checkoutBtn').click();
check('checkout modal opens', document.querySelector('#checkoutModal').hidden === false);
check('summary shows total due', txt('#checkoutSummary').includes('$54.99'));
document.querySelector('#payBtn').click();
check('blocks empty delivery details', document.querySelector('#checkoutError').hidden === false);

document.querySelector('#shipName').value = 'Alex Reyes';
document.querySelector('#shipEmail').value = 'alex@example.com';
document.querySelector('#shipAddress').value = '12 Harbor Lane';
document.querySelector('#shipCity').value = 'Portsmouth';
document.querySelector('#shipZip').value = 'PO1 2AB';
document.querySelector('#walletId').value = 'alex@example.com';
document.querySelector('#walletPin').value = '123';
document.querySelector('#payBtn').click();
check('blocks short wallet PIN', txt('#checkoutError').includes('6 digits'));

console.log('\n[6] E-wallet payment succeeds');
check('wallet balance shows $500.00', txt('#walletBalance') === '$500.00');
document.querySelector('#walletPin').value = '123456';
document.querySelector('#payBtn').click();
check('processing step shown', document.querySelector('#processingStep').hidden === false);
check('e-wallet message shown', txt('#processingText').includes('e-wallet'));

setTimeout(() => {
  check('success step shown', document.querySelector('#successStep').hidden === false);
  check('receipt has SAAK order id', txt('#receipt').includes('SAAK-'));
  check('receipt shows e-wallet method', txt('#receipt').includes('E-Wallet'));
  check('wallet debited: $500 − $54.99 = $445.01', txt('#receipt').includes('$445.01'));
  check('cart cleared after purchase', document.querySelector('#cartCount').hidden === true);
  check('cart persisted to localStorage', window.localStorage.getItem('saak_cart') === '[]');

  console.log('\n[7] Insufficient balance is rejected');
  window.localStorage.setItem('saak_wallet', '10');
  // Re-run app fresh with low balance
  const dom2 = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom2.window.localStorage.setItem('saak_wallet', '10');
  dom2.window.eval(js);
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  const d2 = dom2.window.document;
  d2.querySelectorAll('.product-item')[0].querySelector('.buy-btn').click(); // Buy now: $49 + $5.99 ship
  check('buy-now opens checkout directly', d2.querySelector('#checkoutModal').hidden === false);
  d2.querySelector('#shipName').value = 'A'; d2.querySelector('#shipEmail').value = 'a@b.co';
  d2.querySelector('#shipAddress').value = 'x'; d2.querySelector('#shipCity').value = 'y'; d2.querySelector('#shipZip').value = 'z';
  d2.querySelector('#walletId').value = 'a@b.co'; d2.querySelector('#walletPin').value = '111111';
  d2.querySelector('#payBtn').click();
  check('insufficient balance blocked', d2.querySelector('#checkoutError').textContent.includes('Insufficient'));

  console.log('\n[8] Card + COD paths');
  const cardLabel = d2.querySelector('[data-method="card"]');
  cardLabel.click();
  check('card fields revealed', d2.querySelector('#fieldsCard').hidden === false && d2.querySelector('#fieldsEwallet').hidden === true);
  d2.querySelector('[data-method="cod"]').click();
  check('COD adds $2.00 fee to total', d2.querySelector('#checkoutSummary').textContent.includes('$56.99'));
  check('COD button says Place order', d2.querySelector('#payBtn').textContent === 'Place order');

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}, 2200);

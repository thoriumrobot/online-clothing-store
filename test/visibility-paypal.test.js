// Regression tests for the GitHub Pages bugs and the PayPal integration.
//
// [A] asserts COMPUTED visibility on load — not just the hidden property.
//     The original bug: .modal/.search-bar/.cart-count set display:flex,
//     which overrides the browser's [hidden] rule, so the checkout modal
//     rendered on page load even though hidden was set.
// [B] drives the PayPal path with a stubbed SDK (tests run offline).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
}

function bootStandalone() {
  const html = fs.readFileSync(path.join(root, 'standalone.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://thoriumrobot.github.io/online-clothing-store/' });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

console.log('\n[A] Nothing hidden is visible on page load (computed styles)');
{
  const dom = bootStandalone();
  const { window } = dom;
  const d = window.document;
  const displayOf = (sel) => window.getComputedStyle(d.querySelector(sel)).display;

  check('checkout modal is display:none on load', displayOf('#checkoutModal') === 'none');
  check('search bar is display:none on load', displayOf('#searchBar') === 'none');
  check('cart badge is display:none on load', displayOf('#cartCount') === 'none');
  check('overlay is display:none on load', displayOf('#overlay') === 'none');
  check('card fields hidden while e-wallet selected', displayOf('#fieldsCard') === 'none');
  check('stylesheet forces [hidden] to win', /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(
    fs.readFileSync(path.join(root, 'styles', 'style.css'), 'utf8')));

  // and the modal really appears when checkout is opened
  d.querySelector('.product-item .buy-btn').click();
  check('modal becomes visible at checkout', displayOf('#checkoutModal') === 'flex');
}

console.log('\n[B] PayPal option (stubbed SDK)');
(async () => {
  const dom = bootStandalone();
  const { window } = dom;
  const d = window.document;

  // Stub the PayPal SDK before the method is selected
  let buttonOpts = null;
  window.paypal = {
    Buttons: (opts) => { buttonOpts = opts; return { render: (el) => { el.innerHTML = '<div class="pp-stub">PayPal buttons</div>'; } }; },
  };

  d.querySelector('.product-item .buy-btn').click(); // ₱2,499 + ₱150 shipping
  d.querySelector('[data-method="paypal"]').click();
  await new Promise((r) => setTimeout(r, 0)); // button render resolves a microtask later

  check('PayPal panel shown', window.getComputedStyle(d.querySelector('#fieldsPaypal')).display !== 'none');
  check('site pay button hidden for PayPal', window.getComputedStyle(d.querySelector('#payBtn')).display === 'none');
  check('PayPal buttons rendered', d.querySelector('#paypalButtons .pp-stub') !== null);
  check('footnote says PayPal handles details', d.querySelector('#checkoutFootnote').textContent.includes('PayPal handles'));

  // onClick gate: empty delivery form must reject the popup
  let rejected = false, resolved = false;
  buttonOpts.onClick({}, { resolve: () => { resolved = true; }, reject: () => { rejected = true; } });
  check('empty form rejects PayPal popup', rejected && !resolved);
  check('validation error shown', d.querySelector('#checkoutError').hidden === false);

  // fill delivery details → popup allowed
  d.querySelector('#shipName').value = 'Alex Reyes';
  d.querySelector('#shipEmail').value = 'alex@example.com';
  d.querySelector('#shipAddress').value = '12 Harbor Lane';
  d.querySelector('#shipCity').value = 'Portsmouth';
  d.querySelector('#shipZip').value = 'PO1 2AB';
  rejected = false; resolved = false;
  buttonOpts.onClick({}, { resolve: () => { resolved = true; }, reject: () => { rejected = true; } });
  check('valid form allows PayPal popup', resolved && !rejected);

  // createOrder sends the exact cart total in the right currency
  const order = buttonOpts.createOrder({}, { order: { create: (o) => o } });
  check('order amount equals total (₱2,649.00)', order.purchase_units[0].amount.value === '2649.00');
  check('order currency is PHP', order.purchase_units[0].amount.currency_code === 'PHP');

  // approve → capture → receipt with transaction id, cart cleared
  await buttonOpts.onApprove({ orderID: 'FALLBACK' }, {
    order: { capture: () => Promise.resolve({ id: 'TXN-TEST-123', status: 'COMPLETED' }) },
  });
  check('success step shown after capture', d.querySelector('#successStep').hidden === false);
  check('receipt includes PayPal txn id', d.querySelector('#receipt').textContent.includes('TXN-TEST-123'));
  check('cart cleared after PayPal payment', d.querySelector('#cartCount').hidden === true);

  // SDK failure path shows a helpful error (fresh page, no stub)
  const dom2 = bootStandalone();
  const d2 = dom2.window.document;
  // jsdom neither loads nor errors external scripts → the timeout guard fires
  dom2.window.eval('CONFIG.paypalSdkTimeoutMs = 100;');
  d2.querySelector('.product-item .buy-btn').click();
  d2.querySelector('[data-method="paypal"]').click();
  await new Promise((r) => setTimeout(r, 400));
  check('SDK load failure shows guidance', d2.querySelector('#checkoutError').textContent.includes("PayPal didn't load"));
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

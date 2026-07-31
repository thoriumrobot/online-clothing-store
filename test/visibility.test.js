// [A] Computed-visibility regression tests (the GitHub Pages modal bug),
// [B] payment restriction: only GCash + bank transfer are offered.
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
  check('bank fields hidden while GCash selected', displayOf('#fieldsBank') === 'none');
  check('stylesheet forces [hidden] to win', /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(
    fs.readFileSync(path.join(root, 'styles', 'style.css'), 'utf8')));

  d.querySelector('.product-item .buy-btn').click();
  check('modal becomes visible at checkout', displayOf('#checkoutModal') === 'flex');
}

console.log('\n[B] Only GCash and bank transfer are accepted');
{
  const dom = bootStandalone();
  const d = dom.window.document;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const mainJs = fs.readFileSync(path.join(root, 'scripts', 'main.js'), 'utf8');

  const methods = [...d.querySelectorAll('.pay-method')].map((m) => m.dataset.method);
  check('exactly two payment methods', methods.length === 2);
  check('methods are gcash and bank', methods.includes('gcash') && methods.includes('bank'));
  check('no PayPal anywhere in the page', !/paypal/i.test(html));
  check('no Maya method remnants', !/data-method="maya"|fieldsMaya/.test(html));
  check('no cash-on-delivery remnants', !/cash on delivery|data-method="cod"/i.test(html));
  check('no disabled-method code left in main.js', !/paypal|fieldsMaya|COD_FEE/i.test(mainJs));

  // switching to bank shows the account; the modal validates its ref format
  d.querySelector('.product-item .buy-btn').click();
  d.querySelector('[data-method="bank"]').click();
  check('bank panel visible after selection', dom.window.getComputedStyle(d.querySelector('#fieldsBank')).display !== 'none');
  check('InstaPay cap noted in the panel', d.querySelector('#fieldsBank').textContent.includes('50,000'));
  check('verification promise in footnote', d.querySelector('#checkoutFootnote').textContent.includes('verify'));
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

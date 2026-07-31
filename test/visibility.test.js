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

console.log('\n[C] Automatic GCash gateway (redirect flow)');
{
  const dom = bootStandalone();
  const { window } = dom;
  const d = window.document;

  // Off by default → manual reference flow
  d.querySelector('.product-item .buy-btn').click();
  check('GCash number is the configured wallet', d.querySelector('#gcashNumber').textContent === '+639305314317');
  check('auto off by default → manual pay label', d.querySelector('#payBtn').textContent.includes("I've sent"));

  // Enable auto mode and stub the gateway + redirect
  window.SAAK_CONFIG.autoGcash = { enabled: true, createUrl: 'https://gw.test/create-gcash', returnUrl: '' };
  let posted = null;
  window.fetch = (url, opts) => { posted = { url, body: JSON.parse(opts.body) }; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ checkout_url: 'https://gcash.test/pay/abc' }) }); };

  // reopen so the button label reflects auto mode
  d.querySelector('#modalClose').click();
  d.querySelector('.product-item .buy-btn').click();
  check('auto on → GCash pay label', d.querySelector('#payBtn').textContent.includes('Pay') && d.querySelector('#payBtn').textContent.includes('GCash'));

  // fill valid delivery + trigger
  d.querySelector('#shipName').value = 'Ana Cruz';
  d.querySelector('#shipEmail').value = 'ana@x.ph';
  d.querySelector('#shipAddress').value = '12 Mabini St';
  d.querySelector('#shipRegion').value = 'Metro Manila';
  d.querySelector('#shipZip').value = '1600';
  d.querySelector('#payBtn').click();

  return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 30))).then(() => {
    check('gateway called at configured URL', posted && posted.url === 'https://gw.test/create-gcash');
    check('gateway sent centavo amount + PHP', posted && posted.body.amount === 274800 && posted.body.currency === 'PHP');
    check('gateway sent a return_url', posted && typeof posted.body.return_url === 'string' && posted.body.return_url.length > 0);
    check('manual reference hidden in auto mode', d.querySelector('#gcashRef').hidden === true);
    check('pending order stored for the return trip', !!window.localStorage.getItem('saak_pending_order'));

    // Simulate coming back from GCash with ?payment=success in a FRESH page
    // (the buyer's form fields are empty now — the address must come from
    // the stored pending order, not the blank DOM).
    const pendingRaw = window.localStorage.getItem('saak_pending_order');
    const dom2 = new JSDOM(fs.readFileSync(path.join(root, 'standalone.html'), 'utf8'),
      { runScripts: 'dangerously', url: 'https://thoriumrobot.github.io/online-clothing-store/?payment=success' });
    const w2 = dom2.window, d2 = w2.document;
    w2.localStorage.setItem('saak_pending_order', pendingRaw);
    d2.dispatchEvent(new w2.Event('DOMContentLoaded', { bubbles: true }));

    const successShown = d2.querySelector('#successStep').hidden === false;
    check('auto-GCash return shows the success step', successShown);
    const emailHref = decodeURIComponent(d2.querySelector('#orderEmailBtn').href);
    check('order email keeps the delivery address after redirect', emailHref.includes('12 Mabini St') && emailHref.includes('Metro Manila'));
    check('order email keeps the customer name after redirect', emailHref.includes('Ana Cruz'));
    const clearedVal = w2.localStorage.getItem('saak_pending_order');
    check('pending order cleared after completion', clearedVal === null || clearedVal === 'null');

    console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
}

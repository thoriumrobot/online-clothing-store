// Tests for the display fix: standalone.html must render the catalog with
// zero external files, and index.html must show a clear error (not a blank
// grid) if scripts/products.js fails to load.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
}

console.log('\n[A] standalone.html works as a single file');
{
  const html = fs.readFileSync(path.join(root, 'standalone.html'), 'utf8');
  // runScripts:'dangerously' executes the inline <script> tags exactly
  // like a browser would when the file is double-clicked.
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'file:///standalone.html' });
  const d = dom.window.document;
  d.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));

  const catalog = require(path.join(root, 'scripts', 'products.js'));
  check('inline scripts execute without errors', d.querySelectorAll('.product-item').length > 0);
  check(`renders all ${catalog.length} catalog items`, d.querySelectorAll('.product-item').length === catalog.length);
  check('images are inlined data URIs', [...d.querySelectorAll('.product-item img')].every((i) => i.src.startsWith('data:image')));
  check('no local file references left', !/(src|href)="(styles|scripts|images)\//.test(html));

  // quick purchase sanity inside standalone
  d.querySelector('.product-item .add-btn').click();
  check('add to bag works in standalone', d.querySelector('#cartCount').textContent === '1');
}

console.log('\n[B] index.html without products.js shows a clear error');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const mainOnly = fs.readFileSync(path.join(root, 'scripts', 'main.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.eval(mainOnly); // catalog script "failed to load"
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.document;

  check('no silent empty grid', d.querySelector('#productGrid').innerHTML.trim() !== '');
  check('error message is shown', d.querySelector('.grid-error') !== null);
  check('error mentions standalone.html', d.querySelector('.grid-error').textContent.includes('standalone.html'));
  check('checkout stays disabled', d.querySelector('#checkoutBtn').disabled === true);
}

console.log('\n[C] CLI edits appear in the rendered store');
{
  const { execFileSync } = require('child_process');
  const cli = path.join(root, 'manage-products.js');
  execFileSync('node', [cli, 'add', 'CLI Test Jacket', '99.99', 'outerwear', 'images/overshirt.svg'], { cwd: root });

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  delete require.cache[require.resolve(path.join(root, 'scripts', 'products.js'))];
  const js = fs.readFileSync(path.join(root, 'scripts', 'products.js'), 'utf8') + '\n' +
             fs.readFileSync(path.join(root, 'scripts', 'main.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.eval(js);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const names = [...dom.window.document.querySelectorAll('.product-item h3')].map((h) => h.textContent);
  check('added item renders in the grid', names.includes('CLI Test Jacket'));
  check('price renders correctly', dom.window.document.body.textContent.includes('₱99.99'));

  execFileSync('node', [cli, 'remove', 'CLI Test Jacket'], { cwd: root });
  delete require.cache[require.resolve(path.join(root, 'scripts', 'products.js'))];
  const after = require(path.join(root, 'scripts', 'products.js'));
  check('removed item is gone from catalog', !after.some((p) => p.name === 'CLI Test Jacket'));
}

console.log('\n[D] Peso pricing, sorting, and free-shipping progress');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  delete require.cache[require.resolve(path.join(root, 'scripts', 'products.js'))];
  const js = fs.readFileSync(path.join(root, 'scripts', 'products.js'), 'utf8') + '\n' +
             fs.readFileSync(path.join(root, 'scripts', 'main.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.eval(js);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.document;
  const names = () => [...d.querySelectorAll('.product-item h3')].map((h) => h.textContent);

  check('prices display with peso sign and separators', d.body.textContent.includes('\u20b12,499.00'));
  check('no dollar prices remain on the page', !/\$\d/.test(d.body.textContent));
  check('ticker announces \u20b12,500 free-shipping threshold', d.body.textContent.includes('Free shipping over \u20b12,500'));

  const sort = d.querySelector('#sortSelect');
  sort.value = 'price-asc';
  sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('sort low-to-high puts Canvas Tote (\u20b1999) first', names()[0] === 'Canvas Tote');
  sort.value = 'price-desc';
  sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('sort high-to-low puts Field Overshirt (\u20b13,999) first', names()[0] === 'Field Overshirt');
  sort.value = 'name';
  sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('sort by name is alphabetical', names()[0] === 'Canvas Tote' && names()[1] === 'Column Dress');
  sort.value = 'featured';
  sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  // Progress bar: Everyday Tee \u20b11,299 → needs \u20b11,201 more
  d.querySelectorAll('.product-item')[1].querySelector('.add-btn').click();
  check('progress bar visible with items in cart', d.querySelector('#shipProgress').hidden === false);
  check('progress shows remaining \u20b11,201.00', d.querySelector('#shipProgressText').textContent.includes('\u20b11,201.00'));
  check('bar width reflects subtotal share', d.querySelector('#shipBarFill').style.width === (1299 / 2500 * 100) + '%');
  d.querySelectorAll('.product-item')[1].querySelector('.add-btn').click(); // \u20b12,598 ≥ \u20b12,500
  check('crossing threshold unlocks free shipping message', d.querySelector('#shipProgressText').textContent.includes('unlocked'));
  check('bar caps at 100%', d.querySelector('#shipBarFill').style.width === '100%');
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

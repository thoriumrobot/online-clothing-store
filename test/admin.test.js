// Tests for the smartphone catalog manager (admin.html + scripts/admin.js).
// The GitHub Contents API is stubbed; assertions cover auth, load, add,
// remove, serialization round-trip with the CLI format, and error paths.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'scripts', 'admin.js'), 'utf8');
const productsSource = fs.readFileSync(path.join(root, 'scripts', 'products.js'), 'utf8');
const { parseProducts, serializeProducts } = require(path.join(root, 'scripts', 'admin.js'));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

console.log('\n[A] Serialization round-trips with the CLI format');
{
  const parsed = parseProducts(productsSource);
  check('parses the real catalog (5 items)', parsed.length === 5 && parsed[0].name === 'Everyday Tee');
  const rewritten = serializeProducts(parsed);
  check('serialized output re-parses identically', JSON.stringify(parseProducts(rewritten)) === JSON.stringify(parsed));
  check('output keeps the IIFE wrapper', rewritten.includes('(function () {') && rewritten.includes('})();'));
  check('output keeps browser + Node exports', rewritten.includes('window.SAAK_PRODUCTS') && rewritten.includes('module.exports'));
  // and the CLI's own loader accepts it
  const tmp = path.join(root, 'test', '_tmp_products.js');
  fs.writeFileSync(tmp, rewritten);
  const viaRequire = require(tmp);
  check('Node can require the serialized file', viaRequire.length === 5);
  fs.unlinkSync(tmp);
}

function bootAdmin(fetchStub) {
  const dom = new JSDOM(adminHtml, { runScripts: 'outside-only', url: 'https://thoriumrobot.github.io/online-clothing-store/admin.html' });
  dom.window.fetch = fetchStub;
  dom.window.eval(adminJs);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

(async () => {
  console.log('\n[B] Connect, add, and remove against a stubbed GitHub API');
  const calls = [];
  let currentContent = productsSource;
  let currentSha = 'sha-1';
  const fetchStub = (url, opts = {}) => {
    calls.push({ url, opts });
    if (!opts.method || opts.method === 'GET') {
      if (!opts.headers.Authorization.includes('good-token')) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: b64(currentContent), sha: currentSha }) });
    }
    // PUT
    const body = JSON.parse(opts.body);
    if (body.sha !== currentSha) return Promise.resolve({ ok: false, status: 409 });
    currentContent = Buffer.from(body.content, 'base64').toString('utf8');
    currentSha = 'sha-' + (calls.length);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: currentSha } }) });
  };

  const dom = bootAdmin(fetchStub);
  const d = dom.window.document;

  // wrong token first
  d.querySelector('#tokenInput').value = 'bad-token';
  d.querySelector('#connectBtn').click();
  await tick();
  check('bad token shows rejection', d.querySelector('#status').textContent.includes('Token rejected'));
  check('manager stays locked', d.querySelector('#manageView').hidden === true);

  // good token
  d.querySelector('#tokenInput').value = 'good-token';
  d.querySelector('#connectBtn').click();
  await tick();
  check('connects and unlocks manager', d.querySelector('#manageView').hidden === false);
  check('lists all 5 items', d.querySelectorAll('.admin-item').length === 5);
  check('shows peso prices', d.querySelector('#itemList').textContent.includes('\u20b11,299.00'));

  // add an item
  d.querySelector('#newName').value = 'Monsoon Jacket';
  d.querySelector('#newPrice').value = '4499';
  d.querySelector('#newCategory').value = 'outerwear';
  d.querySelector('#newBadge').value = 'New';
  d.querySelector('#addBtn').click();
  await tick();
  const putCalls = calls.filter((c) => c.opts.method === 'PUT');
  check('add commits via PUT', putCalls.length === 1);
  const committed = Buffer.from(JSON.parse(putCalls[0].opts.body).content, 'base64').toString('utf8');
  check('commit message describes the change', JSON.parse(putCalls[0].opts.body).message.includes('add Monsoon Jacket'));
  check('committed file contains the new item', committed.includes('Monsoon Jacket') && committed.includes('4499.00'));
  check('committed file is CLI-parseable', parseProducts(committed).length === 6);
  check('list refreshes to 6 items', d.querySelectorAll('.admin-item').length === 6);

  // duplicate blocked without a commit
  d.querySelector('#newName').value = 'Monsoon Jacket';
  d.querySelector('#newPrice').value = '999';
  d.querySelector('#addBtn').click();
  await tick();
  check('duplicate name blocked before commit', calls.filter((c) => c.opts.method === 'PUT').length === 1
    && d.querySelector('#status').textContent.includes('already exists'));

  // remove it
  const rows = [...d.querySelectorAll('.admin-item')];
  const target = rows.find((r) => r.textContent.includes('Monsoon Jacket'));
  target.querySelector('.admin-remove').click();
  await tick();
  check('remove commits via PUT', calls.filter((c) => c.opts.method === 'PUT').length === 2);
  check('catalog back to 5 items', parseProducts(currentContent).length === 5);
  check('list refreshes after removal', d.querySelectorAll('.admin-item').length === 5);

  console.log('\n[B2] Edit an existing item');
  // Open the edit form on the first item (Everyday Tee)
  const firstRow = [...d.querySelectorAll('.admin-item')].find((r) => r.textContent.includes('Everyday Tee'));
  firstRow.querySelector('.admin-edit').click();
  const form = d.querySelector('.admin-edit-form');
  check('edit form opens inline under the row', form !== null && form.previousSibling === firstRow);
  check('edit form pre-fills current name', form.querySelector('.edit-name').value === 'Everyday Tee');
  check('edit form pre-fills current price', String(form.querySelector('.edit-price').value) === '1299');
  check('edit form pre-selects current category', form.querySelector('.edit-category').value === 'tops');

  const putsBefore = calls.filter((c) => c.opts.method === 'PUT').length;
  // Change price and category, add a badge, then save
  form.querySelector('.edit-price').value = '1499';
  form.querySelector('.edit-category').value = 'accessories';
  form.querySelector('.edit-badge').value = 'Sale';
  form.querySelector('.edit-save').click();
  await tick();
  const editPut = calls.filter((c) => c.opts.method === 'PUT');
  check('edit commits via PUT', editPut.length === putsBefore + 1);
  const editBody = JSON.parse(editPut[editPut.length - 1].opts.body);
  check('commit message names the edit', editBody.message.includes('edit Everyday Tee'));
  const editedFile = Buffer.from(editBody.content, 'base64').toString('utf8');
  const editedItem = parseProducts(editedFile).find((p) => p.id === 'p1');
  check('price updated in committed file', editedItem.price === 1499);
  check('category updated in committed file', editedItem.category === 'accessories');
  check('badge added in committed file', editedItem.badge === 'Sale');
  check('id is unchanged by an edit', editedItem.id === 'p1');
  check('item count stays the same (edit, not add)', parseProducts(editedFile).length === 5);
  check('edit form closes after save', d.querySelector('.admin-edit-form') === null);

  // Duplicate-name guard on edit
  const rowB = [...d.querySelectorAll('.admin-item')].find((r) => r.textContent.includes('Straight Trousers'));
  rowB.querySelector('.admin-edit').click();
  const formB = d.querySelector('.admin-edit-form');
  const putsBeforeDup = calls.filter((c) => c.opts.method === 'PUT').length;
  formB.querySelector('.edit-name').value = 'District Hoodie'; // already exists
  formB.querySelector('.edit-save').click();
  await tick();
  check('rename to an existing name is blocked before commit',
    calls.filter((c) => c.opts.method === 'PUT').length === putsBeforeDup
    && d.querySelector('#status').textContent.includes('already named'));
  d.querySelector('.admin-edit-form').querySelector('.edit-cancel').click();
  check('cancel closes the edit form', d.querySelector('.admin-edit-form') === null);

  console.log('\n[B3] Admin is usable on a phone');
{
  const adminSrc = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  check('admin inputs are 16px (no iOS focus zoom)',
    !/font: 400 1[0-5]px 'Inter'/.test(adminSrc));
  check('edit/remove buttons meet the 44px tap target',
    (adminSrc.match(/min-height: 44px/g) || []).length >= 2);
  check('logout icon button has a text fallback',
    /id="logoutBtn"[^>]*data-fallback="Exit"/.test(adminSrc));
  check('admin detects a blocked icon font', adminJs.includes("classList.toggle('no-icons'"));
  // Version-agnostic: admin must carry the SAME cache-buster as the store,
  // so a CSS change can't leave one page on a stale stylesheet.
  const storeVer = (/style\.css\?v=(\d+)/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8')) || [])[1];
  const adminVer = (/style\.css\?v=(\d+)/.exec(adminSrc) || [])[1];
  check('admin stylesheet version matches the store', !!storeVer && storeVer === adminVer, 'v=' + adminVer);
}

console.log('\n[B4] Photo upload from the phone');
{
  // jsdom has no canvas, so preparePhoto takes its fallback path — which
  // is exactly the path real older browsers hit.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // tiny PNG header
  const makeFile = (bytes, type, name) => {
    const f = new dom.window.File([bytes], name, { type });
    f.arrayBuffer = () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return f;
  };

  const uploads = [];
  const prevFetch = dom.window.fetch;
  dom.window.fetch = (url, opts = {}) => {
    if (String(url).includes('/contents/images/')) {
      uploads.push({ url: String(url), body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ content: { sha: 'img1' } }) });
    }
    return prevFetch(url, opts);
  };

  // Attach a photo and add an item
  const input = d.querySelector('#newPhoto');
  Object.defineProperty(input, 'files', { value: [makeFile(png, 'image/png', 'shirt.png')], configurable: true });
  d.querySelector('#newName').value = 'Photo Shirt';
  d.querySelector('#newPrice').value = '1750';
  d.querySelector('#newCategory').value = 'tops';
  d.querySelector('#addBtn').click();
  await tick(60);

  check('photo committed into images/', uploads.length === 1);
  check('upload uses a PUT to the repo', uploads[0].url.includes('/contents/images/'));
  check('uploaded filename is slugged + unique',
    /images\/photo-shirt-[a-z0-9]+\.(png|jpg)$/.test(uploads[0].url.split('/contents/')[1]));
  check('commit message describes the upload', uploads[0].body.message.includes('upload photo-shirt'));
  check('image bytes are base64 encoded', typeof uploads[0].body.content === 'string'
    && Buffer.from(uploads[0].body.content, 'base64').slice(1, 4).toString() === 'PNG');

  const catalogNow = parseProducts(currentContent);
  const added = catalogNow.find((p) => p.name === 'Photo Shirt');
  check('new item points at the uploaded photo', !!added && /^images\/photo-shirt-/.test(added.img));
  check('item saved after a successful upload', catalogNow.length === 6);

  // A failing upload must not add the item
  dom.window.fetch = (url, opts = {}) => {
    if (String(url).includes('/contents/images/')) return Promise.resolve({ ok: false, status: 500 });
    return prevFetch(url, opts);
  };
  const input2 = d.querySelector('#newPhoto');
  Object.defineProperty(input2, 'files', { value: [makeFile(png, 'image/png', 'bad.png')], configurable: true });
  d.querySelector('#newName').value = 'Should Not Exist';
  d.querySelector('#newPrice').value = '500';
  d.querySelector('#addBtn').click();
  await tick(60);
  check('failed upload reports an error', d.querySelector('#status').textContent.includes('Photo upload failed'));
  check('failed upload does not add the item',
    !parseProducts(currentContent).some((p) => p.name === 'Should Not Exist'));

  // Non-image files are rejected outright
  Object.defineProperty(d.querySelector('#newPhoto'), 'files',
    { value: [makeFile(Buffer.from('hello'), 'text/plain', 'notes.txt')], configurable: true });
  d.querySelector('#newName').value = 'Text File Item';
  d.querySelector('#newPrice').value = '100';
  d.querySelector('#addBtn').click();
  await tick(60);
  check('non-image file is rejected',
    !parseProducts(currentContent).some((p) => p.name === 'Text File Item'));

  dom.window.fetch = prevFetch;
  // clean up so later sections see the expected catalog
  const leftover = parseProducts(currentContent).find((p) => p.name === 'Photo Shirt');
  if (leftover) {
    const r = [...d.querySelectorAll('.admin-item')].find((x) => x.textContent.includes('Photo Shirt'));
    if (r) { r.querySelector('.admin-remove').click(); await tick(40); }
  }
}

console.log('\n[C] Orders list from the order-log endpoint');
  const sampleOrders = [
    { orderId: 'SAAK-A1', date: '2026-07-30T10:00:00Z', method: 'GCash (manual transfer)', reference: '1112223334445',
      total: 2649, items: [{ name: 'Studio Knit', qty: 1, size: 'M', price: 2499 }],
      name: 'Ana Cruz', address: '12 Mabini St, Pasig 1600, PH', email: 'ana@x.ph' },
    { orderId: 'SAAK-B2', date: '2026-07-31T09:30:00Z', method: 'Bank transfer (InstaPay)', reference: 'INSTA-77',
      total: 999, items: [{ name: 'Canvas Tote', qty: 1, price: 999 }],
      name: 'Ben <b>Reyes</b>', address: '7 Rizal Ave, Cebu 6000, PH', email: 'ben@x.ph' },
  ];
  const realFetch = dom.window.fetch;
  dom.window.fetch = (url, opts) => {
    if (String(url).startsWith('https://orders.test/exec')) {
      const key = new URL(url).searchParams.get('key');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
        key === 'secret-9' ? { orders: sampleOrders } : { error: 'unauthorized' }
      ) });
    }
    return realFetch(url, opts);
  };

  // wrong key rejected
  d.querySelector('#ordersUrl').value = 'https://orders.test/exec';
  d.querySelector('#ordersKey').value = 'wrong';
  d.querySelector('#ordersConnectBtn').click();
  await tick();
  check('wrong access key rejected', d.querySelector('#status').textContent.includes('Access key rejected'));

  // right key loads the list
  d.querySelector('#ordersSettingsBtn').click();
  d.querySelector('#ordersKey').value = 'secret-9';
  d.querySelector('#ordersConnectBtn').click();
  await tick();
  check('orders view unlocked', d.querySelector('#ordersView').hidden === false);
  const orderRows = d.querySelectorAll('.order-item');
  check('renders both orders', orderRows.length === 2);
  check('newest order first', orderRows[0].textContent.includes('SAAK-B2'));
  check('summary counts orders and revenue', d.querySelector('#ordersSummary').textContent.includes('2 order(s)')
    && d.querySelector('#ordersSummary').textContent.includes('\u20b13,648.00'));
  check('shows items, reference, and address', orderRows[1].textContent.includes('1x Studio Knit (M)')
    && orderRows[1].textContent.includes('ref 1112223334445') && orderRows[1].textContent.includes('Pasig'));
  check('customer input rendered as text, not HTML', orderRows[0].querySelector('b') === null
    && orderRows[0].textContent.includes('Ben <b>Reyes</b>'));
  check('settings persist on the device', JSON.parse(dom.window.localStorage.getItem('saak_orders_cfg')).key === 'secret-9');

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

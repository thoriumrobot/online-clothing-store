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
  check('parses the real catalog (9 items)', parsed.length === 9 && parsed[0].name === 'Studio Knit');
  const rewritten = serializeProducts(parsed);
  check('serialized output re-parses identically', JSON.stringify(parseProducts(rewritten)) === JSON.stringify(parsed));
  check('output keeps the IIFE wrapper', rewritten.includes('(function () {') && rewritten.includes('})();'));
  check('output keeps browser + Node exports', rewritten.includes('window.SAAK_PRODUCTS') && rewritten.includes('module.exports'));
  // and the CLI's own loader accepts it
  const tmp = path.join(root, 'test', '_tmp_products.js');
  fs.writeFileSync(tmp, rewritten);
  const viaRequire = require(tmp);
  check('Node can require the serialized file', viaRequire.length === 9);
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
  check('lists all 9 items', d.querySelectorAll('.admin-item').length === 9);
  check('shows peso prices', d.querySelector('#itemList').textContent.includes('\u20b12,499.00'));

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
  check('committed file is CLI-parseable', parseProducts(committed).length === 10);
  check('list refreshes to 10 items', d.querySelectorAll('.admin-item').length === 10);

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
  check('catalog back to 9 items', parseProducts(currentContent).length === 9);
  check('list refreshes after removal', d.querySelectorAll('.admin-item').length === 9);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

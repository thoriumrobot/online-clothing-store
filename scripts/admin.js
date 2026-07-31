/* =========================================================
   SAAK Catalog Manager — edits scripts/products.js in the
   GitHub repository via the Contents API, from any browser
   (built for phones). Each add/remove is one commit; GitHub
   Pages redeploys the store automatically.

   Requires a fine-grained personal access token scoped to
   ONLY this repository with "Contents: Read and write".
   ========================================================= */

const ADMIN = {
  owner: 'thoriumrobot',
  repo: 'online-clothing-store',
  branch: 'master',
  path: 'scripts/products.js',
  imageDir: 'images',
  categories: ['tops', 'bottoms', 'outerwear', 'accessories'],
  // Fallback list; the real list is read from the repo's images/ folder
  // on connect, so newly uploaded photos appear automatically.
  images: [
    'images/tee.svg', 'images/hoodie.svg', 'images/trousers.svg',
    'images/dress.svg', 'images/overshirt.svg', 'images/cap.svg',
    'images/tote.svg', 'images/scarf.svg', 'images/product1.jpg',
  ],
  // Phone photos are 3–12 MB; shrink before committing so the storefront
  // stays fast and the repo doesn't bloat.
  photoMaxDimension: 1400,
  photoQuality: 0.82,
  photoMaxBytes: 2 * 1024 * 1024, // hard stop if resizing is unavailable
};

let token = '';
let fileSha = '';
let products = [];
let ordersCfg = null; // { url, key } for the order-log endpoint

const $ = (sel) => document.querySelector(sel);
const peso = (n) => '\u20b1' + n.toLocaleString('en-PH', { minimumFractionDigits: 2 });

// ---------- status ----------
function status(msg, kind) {
  const el = $('#status');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = 'admin-status ' + (kind || 'ok');
}

// ---------- UTF-8-safe base64 ----------
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Binary (image) → base64, chunked to avoid blowing the call stack.
function b64encodeBytes(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ---------- Photo upload ----------
function slugify(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'photo';
}

/* Downscale + re-encode a phone photo in the browser. Returns
   { bytes, ext }. Falls back to the original file when canvas isn't
   available (older browsers / non-visual environments), rejecting
   anything too large to commit safely. */
async function preparePhoto(file) {
  const original = new Uint8Array(await file.arrayBuffer());

  // SVGs and tiny files pass straight through.
  if (file.type === 'image/svg+xml') return { bytes: original, ext: 'svg' };

  try {
    const bitmapUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('decode failed'));
      im.src = bitmapUrl;
    });

    const max = ADMIN.photoMaxDimension;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))),
        'image/jpeg', ADMIN.photoQuality);
    });
    URL.revokeObjectURL(bitmapUrl);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpg' };
  } catch (e) {
    // Couldn't resize — only allow the original through if it's modest.
    if (original.length > ADMIN.photoMaxBytes) {
      throw new Error(`That photo is ${(original.length / 1048576).toFixed(1)} MB and couldn't be resized on this browser. Please pick a smaller one.`);
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    return { bytes: original, ext: ext || 'jpg' };
  }
}

/* Commits the photo into images/ and returns its repo-relative path. */
async function uploadPhoto(file, nameHint) {
  if (!/^image\//.test(file.type)) throw new Error('That file is not an image.');
  const { bytes, ext } = await preparePhoto(file);
  const filename = `${slugify(nameHint || file.name.replace(/\.[^.]+$/, ''))}-${Date.now().toString(36)}.${ext}`;
  const filePath = `${ADMIN.imageDir}/${filename}`;

  const res = await fetch(
    `https://api.github.com/repos/${ADMIN.owner}/${ADMIN.repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: ghHeaders(),
      body: JSON.stringify({
        message: `[catalog] upload ${filename}`,
        content: b64encodeBytes(bytes),
        branch: ADMIN.branch,
      }),
    }
  );
  if (res.status === 401 || res.status === 403) throw new Error('Token rejected — it needs Contents: Read and write.');
  if (!res.ok) throw new Error(`Photo upload failed (${res.status}). The item was not saved.`);

  if (!ADMIN.images.includes(filePath)) ADMIN.images.unshift(filePath);
  return filePath;
}

/* Reads images/ from the repo so uploaded photos show up in the pickers. */
async function refreshImageList() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ADMIN.owner}/${ADMIN.repo}/contents/${ADMIN.imageDir}?ref=${ADMIN.branch}`,
      { headers: ghHeaders() }
    );
    if (!res.ok) return;
    const files = await res.json();
    if (!Array.isArray(files)) return;
    const found = files
      .filter((f) => f.type === 'file' && /\.(jpe?g|png|webp|gif|svg)$/i.test(f.name))
      .map((f) => `${ADMIN.imageDir}/${f.name}`);
    if (found.length) ADMIN.images = found;
  } catch (e) { /* keep the fallback list */ }
}

// ---------- products.js parse / serialize ----------
// Must round-trip with the format written by manage-products.js.
function parseProducts(source) {
  const match = /const PRODUCTS = \[\n([\s\S]*?)\n\];/.exec(source);
  if (!match) throw new Error('Unrecognized products.js format');
  return JSON.parse('[' + match[1] + ']');
}

function serializeProducts(list) {
  const rows = list.map((p) => {
    const parts = [
      `"id": ${JSON.stringify(p.id)}`,
      `"name": ${JSON.stringify(p.name)}`,
      `"price": ${p.price.toFixed(2)}`,
      `"category": ${JSON.stringify(p.category)}`,
      `"img": ${JSON.stringify(p.img)}`,
    ];
    if (p.badge) parts.push(`"badge": ${JSON.stringify(p.badge)}`);
    return `  { ${parts.join(', ')} }`;
  });
  return `/* =========================================================
   SAAK — product catalog (data only)
   Edit by hand, or use the CLI from the project root:
     node manage-products.js list
     node manage-products.js add "Wool Beanie" 22.00 accessories images/cap.svg "New"
     node manage-products.js remove p7
   This file is regenerated by the CLI — keep the format.
   ========================================================= */
(function () {
const PRODUCTS = [
${rows.join(',\n')}
];

/* Works both in the browser and in Node (for the CLI and tests) */
if (typeof module !== 'undefined') module.exports = PRODUCTS;
if (typeof window !== 'undefined') window.SAAK_PRODUCTS = PRODUCTS;
})();
`;
}

// ---------- GitHub Contents API ----------
const apiUrl = () =>
  `https://api.github.com/repos/${ADMIN.owner}/${ADMIN.repo}/contents/${ADMIN.path}`;

function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function loadCatalog() {
  const res = await fetch(`${apiUrl()}?ref=${ADMIN.branch}&t=${Date.now()}`, { headers: ghHeaders() });
  if (res.status === 401 || res.status === 403) throw new Error('Token rejected — check it has Contents: Read and write on this repository.');
  if (res.status === 404) throw new Error('Catalog file not found — check the repository name and branch.');
  if (!res.ok) throw new Error('GitHub returned an error (' + res.status + '). Try again.');
  const data = await res.json();
  fileSha = data.sha;
  products = parseProducts(b64decode(data.content));
}

async function commitCatalog(message) {
  const res = await fetch(apiUrl(), {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({
      message: '[catalog] ' + message,
      content: b64encode(serializeProducts(products)),
      sha: fileSha,
      branch: ADMIN.branch,
    }),
  });
  if (res.status === 409) {
    await loadCatalog();
    renderList();
    throw new Error('The catalog changed elsewhere and was reloaded — please redo your edit.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Token rejected — reconnect with a valid token.');
  if (!res.ok) throw new Error('Save failed (' + res.status + '). Your change was not committed — try again.');
  const data = await res.json();
  fileSha = data.content.sha;
}

// ---------- UI ----------
function nextId() {
  const max = products.reduce((m, p) => {
    const n = /^p(\d+)$/.exec(p.id);
    return n ? Math.max(m, parseInt(n[1], 10)) : m;
  }, 0);
  return 'p' + (max + 1);
}

function categoryOptions(selected) {
  return ADMIN.categories
    .map((c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`)
    .join('');
}

function clearPhotoPicker() {
  const input = $('#newPhoto');
  if (input) input.value = '';
  const prev = $('#newPhotoPreview');
  if (prev) { prev.hidden = true; prev.removeAttribute('src'); }
}

// Shows a local preview of a chosen photo before it is uploaded.
function wirePhotoPreview(input, preview) {
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) { preview.hidden = true; preview.removeAttribute('src'); return; }
    if (!/^image\//.test(file.type)) {
      status('That file is not an image.', 'err');
      input.value = '';
      return;
    }
    try {
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    } catch (e) { /* preview is optional */ }
  });
}

function imageOptions(selected) {
  return ADMIN.images
    .map((img) => `<option value="${img}"${img === selected ? ' selected' : ''}>${img.replace('images/', '')}</option>`)
    .join('');
}

function renderList() {
  const box = $('#itemList');
  $('#itemCount').textContent = products.length;
  box.innerHTML = '';
  products.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'admin-item';
    row.innerHTML = `
      <img src="${p.img}" alt="">
      <div class="admin-item-info">
        <strong></strong>
        <span>${p.id} · ${p.category} · <span class="mono">${peso(p.price)}</span>${p.badge ? ' · ' + p.badge : ''}</span>
      </div>
      <div class="admin-item-actions">
        <button class="admin-edit">Edit</button>
        <button class="admin-remove">Remove</button>
      </div>`;
    row.querySelector('strong').textContent = p.name;
    row.querySelector('.admin-remove').addEventListener('click', () => removeItem(p.id));
    row.querySelector('.admin-edit').addEventListener('click', () => openEditForm(p.id, row));
    box.appendChild(row);
  });
}

// Expands an inline edit form beneath the item's row.
function openEditForm(id, row) {
  if (row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('admin-edit-form')) {
    row.nextSibling.remove(); // toggle closed
    return;
  }
  // Close any other open edit form first
  document.querySelectorAll('.admin-edit-form').forEach((f) => f.remove());

  const p = products.find((x) => x.id === id);
  if (!p) return;

  const form = document.createElement('div');
  form.className = 'admin-edit-form';
  form.innerHTML = `
    <input type="text" class="edit-name" placeholder="Item name">
    <input type="number" class="edit-price" placeholder="Price in ₱" min="1" step="0.01" inputmode="decimal">
    <select class="edit-category">${categoryOptions(p.category)}</select>
    <label class="photo-field">
      <input type="file" class="edit-photo" accept="image/*">
      <span>Replace photo…</span>
    </label>
    <img class="photo-preview edit-preview" hidden alt="">
    <select class="edit-image">${imageOptions(p.img)}</select>
    <input type="text" class="edit-badge" placeholder="Badge (optional)">
    <div class="edit-row">
      <button class="btn btn-primary edit-save">Save changes</button>
      <button class="btn btn-ghost edit-cancel">Cancel</button>
    </div>`;
  // Set values via properties to avoid HTML-escaping issues
  form.querySelector('.edit-name').value = p.name;
  form.querySelector('.edit-price').value = p.price;
  form.querySelector('.edit-badge').value = p.badge || '';
  wirePhotoPreview(form.querySelector('.edit-photo'), form.querySelector('.edit-preview'));
  form.querySelector('.edit-cancel').addEventListener('click', () => form.remove());
  form.querySelector('.edit-save').addEventListener('click', () => saveEdit(id, form));

  row.after(form);
  form.querySelector('.edit-name').focus();
}

async function saveEdit(id, form) {
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return;

  const name = form.querySelector('.edit-name').value.trim();
  const price = parseFloat(form.querySelector('.edit-price').value);
  const category = form.querySelector('.edit-category').value;
  const badge = form.querySelector('.edit-badge').value.trim();
  const photoInput = form.querySelector('.edit-photo');
  const photo = photoInput && photoInput.files && photoInput.files[0];
  let img = form.querySelector('.edit-image').value;

  if (!name) return status('Enter an item name.', 'err');
  if (!isFinite(price) || price <= 0) return status('Enter a valid price above zero.', 'err');
  // A different item must not already have this name
  if (products.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
    return status(`Another item is already named "${name}".`, 'err');
  }

  setBusy(true);
  if (photo) {
    status('Uploading photo…');
    try {
      img = await uploadPhoto(photo, name);
    } catch (e) {
      setBusy(false);
      return status(e.message, 'err');
    }
  }

  const before = { ...products[idx] };
  const updated = { id, name, price, category, img };
  if (badge) updated.badge = badge;

  // Nothing changed? Skip the commit.
  if (JSON.stringify(before) === JSON.stringify(updated)) {
    form.remove();
    setBusy(false);
    return status('No changes to save.');
  }

  status('Saving to GitHub…');
  try {
    products[idx] = updated;
    await commitCatalog(`edit ${updated.name} (${id})`);
    renderList();
    status(`Updated ${updated.name} — live site updates in ~1–2 minutes.`);
  } catch (e) {
    products[idx] = before;
    renderList();
    status(e.message, 'err');
  }
  setBusy(false);
}

function setBusy(busy) {
  document.querySelectorAll('#manageView button').forEach((b) => { b.disabled = busy; });
}

async function addItem() {
  const name = $('#newName').value.trim();
  const price = parseFloat($('#newPrice').value);
  const category = $('#newCategory').value;
  const badge = $('#newBadge').value.trim();
  const photo = $('#newPhoto').files && $('#newPhoto').files[0];
  let img = $('#newImage').value;

  if (!name) return status('Enter an item name.', 'err');
  if (!isFinite(price) || price <= 0) return status('Enter a valid price above zero.', 'err');
  if (products.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return status(`"${name}" already exists — remove it first or pick another name.`, 'err');
  }

  setBusy(true);
  // Upload the photo first: if it fails, nothing is added.
  if (photo) {
    status('Uploading photo…');
    try {
      img = await uploadPhoto(photo, name);
      $('#newImage').innerHTML = imageOptions(img);
    } catch (e) {
      setBusy(false);
      return status(e.message, 'err');
    }
  }

  const item = { id: nextId(), name, price, category, img };
  if (badge) item.badge = badge;

  status('Saving to GitHub…');
  try {
    products.push(item);
    await commitCatalog(`add ${item.name} (${item.id})`);
    renderList();
    $('#newName').value = ''; $('#newPrice').value = ''; $('#newBadge').value = '';
    clearPhotoPicker();
    status(`Added ${item.name} — live site updates in ~1–2 minutes.`);
  } catch (e) {
    products = products.filter((p) => p.id !== item.id);
    renderList();
    status(e.message, 'err');
  }
  setBusy(false);
}

async function removeItem(id) {
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const [gone] = products.splice(idx, 1);

  setBusy(true);
  status('Saving to GitHub…');
  try {
    await commitCatalog(`remove ${gone.name} (${gone.id})`);
    renderList();
    status(`Removed ${gone.name} — live site updates in ~1–2 minutes.`);
  } catch (e) {
    products.splice(idx, 0, gone);
    renderList();
    status(e.message, 'err');
  }
  setBusy(false);
}

// ---------- Orders (read from the order-log endpoint) ----------
function loadOrdersCfg() {
  try { ordersCfg = JSON.parse(localStorage.getItem('saak_orders_cfg')); }
  catch (e) { ordersCfg = null; }
  if (ordersCfg && !ordersCfg.url) ordersCfg = null;
}

function showOrdersUi() {
  const configured = !!ordersCfg;
  $('#ordersSetup').hidden = configured;
  $('#ordersView').hidden = !configured;
  if (ordersCfg) { $('#ordersUrl').value = ordersCfg.url; $('#ordersKey').value = ordersCfg.key || ''; }
}

function renderOrders(list) {
  const sorted = [...list].sort((x, y) => new Date(y.date) - new Date(x.date));
  const revenue = sorted.reduce((s, o) => s + (Number(o.total) || 0), 0);
  $('#ordersSummary').textContent = `${sorted.length} order(s) · ${peso(revenue)} total`;

  const box = $('#ordersList');
  box.innerHTML = '';
  if (sorted.length === 0) {
    const p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = 'No orders logged yet.';
    box.appendChild(p);
    return;
  }
  // Customer-entered fields are set via textContent, never innerHTML.
  sorted.forEach((o) => {
    const row = document.createElement('div');
    row.className = 'order-item';
    const top = document.createElement('div');
    top.className = 'order-top';
    const id = document.createElement('strong');
    id.textContent = o.orderId || '(no id)';
    const total = document.createElement('span');
    total.className = 'mono';
    total.textContent = peso(Number(o.total) || 0);
    top.append(id, total);
    row.appendChild(top);

    const metas = [
      `${o.date ? new Date(o.date).toLocaleString('en-PH') : ''} · ${o.method || ''}${o.reference ? ' · ref ' + o.reference : ''}`,
      (o.items || []).map((i) => `${i.qty}x ${i.name}${i.size ? ' (' + i.size + ')' : ''}`).join(', '),
      `${o.name || ''} — ${o.address || ''}`,
      o.email || '',
    ];
    metas.filter(Boolean).forEach((text) => {
      const span = document.createElement('span');
      span.className = 'order-meta';
      span.textContent = text;
      row.appendChild(span);
    });
    box.appendChild(row);
  });
}

async function fetchOrders() {
  if (!ordersCfg) return;
  status('Loading orders…');
  try {
    const sep = ordersCfg.url.includes('?') ? '&' : '?';
    const res = await fetch(`${ordersCfg.url}${sep}key=${encodeURIComponent(ordersCfg.key || '')}&t=${Date.now()}`);
    if (!res.ok) throw new Error('Orders endpoint returned ' + res.status + ' — check the URL.');
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error === 'unauthorized'
        ? 'Access key rejected by the orders endpoint.'
        : 'Orders endpoint error: ' + data.error);
    }
    renderOrders(data.orders || []);
    status(`Loaded ${(data.orders || []).length} order(s).`);
  } catch (e) {
    status(e.message, 'err');
  }
}

function saveOrdersCfg() {
  const url = $('#ordersUrl').value.trim();
  const key = $('#ordersKey').value.trim();
  if (!/^https:\/\//.test(url)) return status('Enter the https:// Apps Script /exec URL.', 'err');
  ordersCfg = { url, key };
  localStorage.setItem('saak_orders_cfg', JSON.stringify(ordersCfg));
  showOrdersUi();
  fetchOrders();
}

async function connect() {
  token = $('#tokenInput').value.trim();
  if (!token) return status('Paste your access token first.', 'err');
  status('Connecting…');
  try {
    await loadCatalog();
    await refreshImageList();
    $('#newImage').innerHTML = imageOptions();
    if ($('#rememberToken').checked) localStorage.setItem('saak_admin_token', token);
    sessionStorage.setItem('saak_admin_token', token);
    $('#authView').hidden = true;
    $('#manageView').hidden = false;
    $('#logoutBtn').hidden = false;
    renderList();
    loadOrdersCfg();
    showOrdersUi();
    status(`Connected — ${products.length} items in the catalog.`);
    if (ordersCfg) fetchOrders();
  } catch (e) {
    status(e.message, 'err');
  }
}

function logout() {
  token = '';
  localStorage.removeItem('saak_admin_token');
  sessionStorage.removeItem('saak_admin_token');
  $('#manageView').hidden = true;
  $('#logoutBtn').hidden = true;
  $('#authView').hidden = false;
  $('#tokenInput').value = '';
  status('');
}

function init() {
  // Same icon-font guard as the storefront: if the Font Awesome CDN is
  // blocked, swap icon-only buttons to their text fallback.
  const checkIcons = () => {
    let loaded = false;
    try {
      loaded = !!(document.fonts && (
        document.fonts.check('16px "Font Awesome 6 Free"') ||
        document.fonts.check('900 16px "Font Awesome 6 Free"')
      ));
    } catch (e) { loaded = false; }
    document.body.classList.toggle('no-icons', !loaded);
  };
  setTimeout(checkIcons, 1200);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(checkIcons).catch(() => {});
  }

  // image choices for the add form
  $('#newImage').innerHTML = imageOptions();
  wirePhotoPreview($('#newPhoto'), $('#newPhotoPreview'));

  $('#connectBtn').addEventListener('click', connect);
  $('#addBtn').addEventListener('click', addItem);
  $('#logoutBtn').addEventListener('click', logout);
  $('#ordersConnectBtn').addEventListener('click', saveOrdersCfg);
  $('#ordersRefreshBtn').addEventListener('click', fetchOrders);
  $('#ordersSettingsBtn').addEventListener('click', () => { $('#ordersSetup').hidden = false; $('#ordersView').hidden = true; });

  const saved = sessionStorage.getItem('saak_admin_token') || localStorage.getItem('saak_admin_token');
  if (saved) {
    $('#tokenInput').value = saved;
    connect();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

if (typeof module !== 'undefined') {
  module.exports = { parseProducts, serializeProducts };
}

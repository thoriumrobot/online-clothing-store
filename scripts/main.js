/* =========================================================
   SAAK — storefront logic
   Catalog rendering · search & filters · cart · checkout
   with a simulated e-wallet payment flow (front-end demo).
   ========================================================= */

// ---------- Payment configuration ----------
// Two accepted methods, both manual-verification: GCash and bank
// transfer via InstaPay. Set your real account details below, then run
// `node tools/build-standalone.js`. You verify each transfer in your own
// app/bank before shipping — never trust a reference number alone.
const CONFIG = {
  // Orders are emailed here (GitHub Pages has no backend to record them).
  storeEmail: 'orders@saak-store.example',        // ← change to your email
  // Optional: also POST every order to this URL (e.g. a Google Apps
  // Script that appends to a spreadsheet — see README → "Order list").
  // Leave '' to disable.
  orderLogUrl: '',
  // Manual-transfer accounts shown at checkout — change to your real ones.
  gcash: { name: 'SAAK Store', number: '0917 000 0000' },
  bank:  { bank: 'BPI', name: 'SAAK Store', number: '1234 5678 90' },
};
// Exposed for console tweaks and tests
if (typeof window !== 'undefined') window.SAAK_CONFIG = CONFIG;

// ---------- Catalog ----------
// Product data lives in scripts/products.js (edit it directly or via
// `node manage-products.js add/remove/list` from the project root).
const PRODUCTS = (typeof window !== 'undefined' && window.SAAK_PRODUCTS) || [];

const SIZED_CATEGORIES = ['tops', 'bottoms', 'outerwear'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const FREE_SHIPPING_THRESHOLD = 2500;   // ₱
const SHIPPING_FLAT = 150;              // ₱ standard courier rate

// ---------- Safe storage (falls back to memory if unavailable) ----------
const store = (() => {
  let mem = {};
  const ok = (() => {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
    catch { return false; }
  })();
  return {
    get(key, fallback) {
      try {
        const raw = ok ? localStorage.getItem(key) : mem[key];
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (ok) localStorage.setItem(key, raw); else mem[key] = raw;
      } catch { /* ignore */ }
    },
  };
})();

// ---------- State ----------
let cart = store.get('saak_cart', []);            // [{id, size, qty}]
let activeFilter = 'all';
let activeSort = 'featured';
let searchTerm = '';

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const money = (n) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const cartCount = () => cart.reduce((s, i) => s + i.qty, 0);
const cartSubtotal = () => cart.reduce((s, i) => s + findProduct(i.id).price * i.qty, 0);
const shippingFor = (subtotal) => (subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD) ? 0 : SHIPPING_FLAT;

function saveCart() { store.set('saak_cart', cart); }

function toast(msg, icon = 'fa-check') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<i class="fas ${icon}"></i><span></span>`;
  el.querySelector('span').textContent = msg;
  $('#toastStack').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

// ---------- Product grid ----------
function renderProducts() {
  const grid = $('#productGrid');

  // Catalog failed to load (e.g. the page was opened without its
  // scripts/ folder). Say so instead of showing an empty shop.
  if (PRODUCTS.length === 0) {
    grid.innerHTML = `
      <div class="grid-error">
        <i class="fas fa-triangle-exclamation"></i>
        <p><strong>The catalog didn't load.</strong></p>
        <p>Make sure <code>scripts/products.js</code> is next to this page, and open the site
        from the project folder (e.g. <code>python3 -m http.server 8080</code>) — or use
        <code>standalone.html</code>, which has everything built in.</p>
      </div>`;
    $('#emptyResults').hidden = true;
    return;
  }

  const term = searchTerm.trim().toLowerCase();
  const visible = PRODUCTS.filter((p) =>
    (activeFilter === 'all' || p.category === activeFilter) &&
    (!term || p.name.toLowerCase().includes(term) || p.category.includes(term))
  );
  if (activeSort === 'price-asc') visible.sort((a, b) => a.price - b.price);
  else if (activeSort === 'price-desc') visible.sort((a, b) => b.price - a.price);
  else if (activeSort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name));

  $('#emptyResults').hidden = visible.length > 0;
  grid.innerHTML = '';

  visible.forEach((p) => {
    const hasSizes = SIZED_CATEGORIES.includes(p.category);
    const card = document.createElement('article');
    card.className = 'product-item';
    card.innerHTML = `
      <div class="product-media">
        <img src="${p.img}" alt="${p.name}" loading="lazy">
        ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ''}
      </div>
      <div class="product-info">
        <h3>${p.name}</h3>
        <p class="product-cat">${p.category}</p>
        <p class="product-price mono">${money(p.price)}</p>
        ${hasSizes ? `
          <div class="size-row" role="group" aria-label="Choose size">
            ${SIZES.map((s, i) => `<button class="size ${i === 2 ? 'is-active' : ''}" data-size="${s}">${s}</button>`).join('')}
          </div>` : ''}
        <div class="product-actions">
          <button class="btn btn-ghost add-btn"><i class="fas fa-bag-shopping"></i> Add to bag</button>
          <button class="btn btn-primary buy-btn">Buy now</button>
        </div>
      </div>`;

    // size selection
    card.querySelectorAll('.size').forEach((btn) => {
      btn.addEventListener('click', () => {
        card.querySelectorAll('.size').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
      });
    });

    const selectedSize = () => {
      const active = card.querySelector('.size.is-active');
      return active ? active.dataset.size : null;
    };

    card.querySelector('.add-btn').addEventListener('click', () => {
      addToCart(p.id, selectedSize());
      toast(`${p.name} added to your bag`);
    });
    card.querySelector('.buy-btn').addEventListener('click', () => {
      addToCart(p.id, selectedSize());
      openCart();
      openCheckout();
    });

    grid.appendChild(card);
  });
}

// ---------- Cart ----------
function addToCart(id, size) {
  const line = cart.find((i) => i.id === id && i.size === size);
  if (line) line.qty += 1;
  else cart.push({ id, size, qty: 1 });
  saveCart();
  renderCart();
}

function changeQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart();
  renderCart();
}

function removeLine(index) {
  cart.splice(index, 1);
  saveCart();
  renderCart();
}

function renderCart() {
  const box = $('#cartItems');
  const count = cartCount();

  // badge
  const badge = $('#cartCount');
  badge.hidden = count === 0;
  badge.textContent = count;
  $('#cartHeadCount').textContent = count ? `(${count})` : '';

  box.innerHTML = '';
  if (cart.length === 0) {
    box.innerHTML = `
      <div class="cart-empty">
        <i class="fas fa-bag-shopping"></i>
        <p>Your bag is empty.</p>
        <a href="#collection" class="btn btn-ghost" id="emptyShopBtn">Browse the collection</a>
      </div>`;
    const b = $('#emptyShopBtn');
    if (b) b.addEventListener('click', closeCart);
  } else {
    cart.forEach((line, idx) => {
      const p = findProduct(line.id);
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${p.img}" alt="${p.name}">
        <div class="cart-item-info">
          <h4>${p.name}</h4>
          <p class="muted">${line.size ? 'Size ' + line.size + ' · ' : ''}<span class="mono">${money(p.price)}</span></p>
          <div class="qty-row">
            <button class="qty-btn" data-act="dec" aria-label="Decrease quantity">−</button>
            <span class="mono">${line.qty}</span>
            <button class="qty-btn" data-act="inc" aria-label="Increase quantity">+</button>
            <button class="link-btn" data-act="rm">Remove</button>
          </div>
        </div>
        <span class="mono cart-line-total">${money(p.price * line.qty)}</span>`;
      row.querySelector('[data-act="dec"]').addEventListener('click', () => changeQty(idx, -1));
      row.querySelector('[data-act="inc"]').addEventListener('click', () => changeQty(idx, 1));
      row.querySelector('[data-act="rm"]').addEventListener('click', () => removeLine(idx));
      box.appendChild(row);
    });
  }

  const subtotal = cartSubtotal();
  const shipping = shippingFor(subtotal);

  // Free-shipping progress bar
  const progress = $('#shipProgress');
  progress.hidden = subtotal === 0;
  if (subtotal > 0) {
    const pct = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
    $('#shipBarFill').style.width = pct + '%';
    $('#shipProgressText').innerHTML = subtotal >= FREE_SHIPPING_THRESHOLD
      ? '<strong>Free shipping unlocked!</strong>'
      : `Add <strong>${money(FREE_SHIPPING_THRESHOLD - subtotal)}</strong> more for free shipping`;
  }

  $('#cartSubtotal').textContent = money(subtotal);
  $('#cartShipping').textContent = subtotal === 0 ? '—' : (shipping === 0 ? 'Free' : money(shipping));
  $('#cartTotal').textContent = money(subtotal + shipping);
  $('#checkoutBtn').disabled = cart.length === 0;
}

function openCart() {
  $('#cartDrawer').classList.add('open');
  $('#cartDrawer').setAttribute('aria-hidden', 'false');
  $('#overlay').hidden = false;
  document.body.classList.add('no-scroll');
}
function closeCart() {
  $('#cartDrawer').classList.remove('open');
  $('#cartDrawer').setAttribute('aria-hidden', 'true');
  if ($('#checkoutModal').hidden) {
    $('#overlay').hidden = true;
    document.body.classList.remove('no-scroll');
  }
}

// ---------- Checkout ----------
let selectedMethod = 'gcash';

function orderTotal() {
  const subtotal = cartSubtotal();
  return subtotal + shippingFor(subtotal);
}

function renderCheckoutSummary() {
  const subtotal = cartSubtotal();
  const shipping = shippingFor(subtotal);
  const lines = cart.map((l) => {
    const p = findProduct(l.id);
    return `<div class="sum-row"><span>${l.qty} × ${p.name}${l.size ? ' (' + l.size + ')' : ''}</span><span class="mono">${money(p.price * l.qty)}</span></div>`;
  }).join('');
  $('#checkoutSummary').innerHTML = `
    ${lines}
    <div class="sum-row muted"><span>Shipping</span><span class="mono">${shipping === 0 ? 'Free' : money(shipping)}</span></div>
    <div class="sum-row total"><span>Total due</span><span class="mono">${money(orderTotal())}</span></div>`;
  $('#payBtn').textContent = `I've sent ${money(orderTotal())} — place order`;
  const capWarning = selectedMethod === 'bank' && orderTotal() > 50000
    ? ' This order exceeds InstaPay\'s ₱50,000 per-transaction cap — send via PESONet or split into multiple transfers.'
    : '';
  $('#checkoutFootnote').innerHTML =
    '<i class="fas fa-lock"></i> Manual transfer — we verify the money arrived in our account before shipping.' + capWarning;
}

function openCheckout() {
  if (cart.length === 0) { toast('Your bag is empty', 'fa-circle-info'); return; }
  closeCart();
  $('#checkoutModal').hidden = false;
  $('#checkoutModal').setAttribute('aria-hidden', 'false');
  $('#overlay').hidden = false;
  document.body.classList.add('no-scroll');
  showStep('checkoutStep');
  renderCheckoutSummary();
}

function closeCheckout() {
  // Never close mid-payment: the confirmation — and the order-email step
  // that actually delivers the order to the store — would be lost.
  if (!$('#processingStep').hidden) return;
  $('#checkoutModal').hidden = true;
  $('#checkoutModal').setAttribute('aria-hidden', 'true');
  $('#overlay').hidden = true;
  document.body.classList.remove('no-scroll');
  $('#checkoutError').hidden = true;
}

function showStep(id) {
  ['checkoutStep', 'processingStep', 'successStep'].forEach((s) => { $('#' + s).hidden = s !== id; });
}

function showError(msg) {
  const el = $('#checkoutError');
  el.textContent = msg;
  el.hidden = false;
}

function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function validateCheckout() {
  const name = $('#shipName').value.trim();
  const email = $('#shipEmail').value.trim();
  const address = $('#shipAddress').value.trim();
  const city = $('#shipCity').value.trim();
  const zip = $('#shipZip').value.trim();

  if (!name || !address || !city || !zip) return 'Please fill in all delivery details.';
  if (!validEmail(email)) return 'Please enter a valid email for your receipt.';

  if (selectedMethod === 'gcash' && !/^\d{13}$/.test($('#gcashRef').value.trim())) {
    return 'Enter the 13-digit reference number from your GCash receipt.';
  }
  if (selectedMethod === 'bank' && !/^[A-Za-z0-9-]{6,25}$/.test($('#bankRef').value.replace(/\s/g, ''))) {
    return 'Enter the reference / trace number from your bank transfer receipt (6–25 characters).';
  }

  return null; // valid
}

/* The store has no backend, so the order itself must travel to the
   store owner — via a prefilled email (or copied text) the customer
   sends. This is how the order actually reaches the store. */
let lastOrderText = '';

function buildOrderText(orderId, methodLabel, total, reference) {
  const items = cart.map((l) => {
    const p = findProduct(l.id);
    return `- ${l.qty} x ${p.name}${l.size ? ' (' + l.size + ')' : ''} — ${money(p.price * l.qty)}`;
  }).join('\n');
  return [
    `Order ${orderId}`,
    '',
    items,
    `Total: ${money(total)}`,
    `Payment: ${methodLabel}${reference ? ' — ref ' + reference : ''}`,
    '',
    `Deliver to: ${$('#shipName').value.trim()}`,
    `${$('#shipAddress').value.trim()}, ${$('#shipCity').value.trim()} ${$('#shipZip').value.trim()}, ${$('#shipCountry').value}`,
    `Email: ${$('#shipEmail').value.trim()}`,
  ].join('\n');
}

/* Shared success path for every payment method. `extraRows` lets a
   method add its own receipt lines (e.g. the payment reference). */
function finalizeOrder(methodLabel, total, extraRows = '', isCod = false, reference = '') {
  const orderId = 'SAAK-' + Date.now().toString(36).toUpperCase();

  // Build the order message BEFORE the cart is cleared
  lastOrderText = buildOrderText(orderId, methodLabel, total, reference);

  // Optional order log — fire-and-forget so checkout never blocks on it.
  // text/plain avoids a CORS preflight, which Apps Script can't answer.
  if (CONFIG.orderLogUrl) {
    try {
      fetch(CONFIG.orderLogUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          orderId,
          date: new Date().toISOString(),
          method: methodLabel,
          reference,
          total,
          items: cart.map((l) => {
            const p = findProduct(l.id);
            return { name: p.name, size: l.size, qty: l.qty, price: p.price };
          }),
          name: $('#shipName').value.trim(),
          address: `${$('#shipAddress').value.trim()}, ${$('#shipCity').value.trim()} ${$('#shipZip').value.trim()}, ${$('#shipCountry').value}`,
          email: $('#shipEmail').value.trim(),
        }),
      }).catch(() => {});
    } catch (e) { /* logging must never break checkout */ }
  }
  $('#orderEmailBtn').href = 'mailto:' + CONFIG.storeEmail +
    '?subject=' + encodeURIComponent('Order ' + orderId) +
    '&body=' + encodeURIComponent(lastOrderText);

  $('#successDetail').textContent =
    `Order recorded with your ${methodLabel} reference. We ship as soon as the transfer is verified in our account.`;
  $('#sendOrderText').textContent = 'Last step: email us your order so we can process it.';
  $('#receipt').innerHTML = `
    <div class="sum-row"><span>Order</span><span>${orderId}</span></div>
    <div class="sum-row"><span>Method</span><span>${methodLabel}</span></div>
    <div class="sum-row"><span>Total</span><span>${money(total)}</span></div>
    ${extraRows}`;

  cart = [];
  saveCart();
  renderCart();
  $('#gcashRef').value = '';
  $('#bankRef').value = '';
  showStep('successStep');
}

function placeOrder() {
  const error = validateCheckout();
  if (error) { showError(error); return; }
  $('#checkoutError').hidden = true;

  const total = orderTotal();
  const method = selectedMethod;
  showStep('processingStep');
  $('#processingText').textContent = 'Recording your order…';

  setTimeout(() => {
    const reference = method === 'gcash'
      ? $('#gcashRef').value.trim()
      : $('#bankRef').value.replace(/\s/g, '');
    const label = method === 'gcash' ? 'GCash (manual transfer)' : 'Bank transfer (InstaPay)';
    const extra = `<div class="sum-row"><span>Payment ref</span><span>${reference}</span></div>`;
    finalizeOrder(label, total, extra, false, reference);
  }, 1200);
}

// ---------- Wiring ----------
function init() {
  renderProducts();
  renderCart();

  // Mobile menu
  const menuIcon = $('#menuIcon');
  const navLinks = $('#navLinks');
  menuIcon.addEventListener('click', () => {
    const open = navLinks.classList.toggle('active');
    menuIcon.setAttribute('aria-expanded', String(open));
  });
  navLinks.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => navLinks.classList.remove('active')));

  // Navbar on scroll
  window.addEventListener('scroll', () => {
    $('#navbar').classList.toggle('scrolled', window.scrollY > 0);
  });

  // Search
  $('#searchToggle').addEventListener('click', () => {
    const bar = $('#searchBar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $('#searchInput').focus();
  });
  $('#searchClose').addEventListener('click', () => {
    $('#searchBar').hidden = true;
    $('#searchInput').value = '';
    searchTerm = '';
    renderProducts();
  });
  $('#searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderProducts();
  });

  // Sort
  $('#sortSelect').addEventListener('change', (e) => {
    activeSort = e.target.value;
    renderProducts();
  });

  // Filters
  document.querySelectorAll('#filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filters .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      activeFilter = chip.dataset.filter;
      renderProducts();
    });
  });

  // Cart drawer
  $('#cartToggle').addEventListener('click', openCart);
  $('#cartClose').addEventListener('click', closeCart);
  $('#overlay').addEventListener('click', () => { closeCart(); closeCheckout(); });
  $('#checkoutBtn').addEventListener('click', openCheckout);

  // Checkout modal
  $('#modalClose').addEventListener('click', closeCheckout);
  $('#doneBtn').addEventListener('click', () => { closeCheckout(); toast('Thanks for shopping with SAAK!'); });
  $('#payBtn').addEventListener('click', placeOrder);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeCheckout(); closeCart(); }
  });

  // Payment method switching
  document.querySelectorAll('.pay-method').forEach((label) => {
    label.addEventListener('click', () => {
      document.querySelectorAll('.pay-method').forEach((l) => l.classList.remove('is-selected'));
      label.classList.add('is-selected');
      label.querySelector('input').checked = true;
      selectedMethod = label.dataset.method;
      $('#fieldsGcash').hidden = selectedMethod !== 'gcash';
      $('#fieldsBank').hidden = selectedMethod !== 'bank';
      renderCheckoutSummary();
    });
  });

  // Show the configured transfer accounts
  $('#gcashNumber').textContent = CONFIG.gcash.number;
  $('#gcashName').textContent = CONFIG.gcash.name;
  $('#bankName').textContent = CONFIG.bank.bank;
  $('#bankNumber').textContent = CONFIG.bank.number;
  $('#bankAccountName').textContent = CONFIG.bank.name;

  // GCash references are digits only
  $('#gcashRef').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 13);
  });

  // Copy order details (post-purchase)
  $('#orderCopyBtn').addEventListener('click', () => {
    const done = () => toast('Order details copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastOrderText).then(done, () => toast('Copy failed — use the email button', 'fa-circle-info'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = lastOrderText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch { toast('Copy failed — use the email button', 'fa-circle-info'); }
      ta.remove();
    }
  });

  // Newsletter + contact (demo handlers)
  $('#newsletterBtn').addEventListener('click', () => {
    const email = $('#newsletterEmail').value.trim();
    if (!validEmail(email)) { toast('Enter a valid email to subscribe', 'fa-circle-info'); return; }
    $('#newsletterEmail').value = '';
    toast("You're on the list — welcome to SAAK");
  });
  $('#contactSend').addEventListener('click', () => {
    const name = $('#contactName').value.trim();
    const email = $('#contactEmail').value.trim();
    const msg = $('#contactMessage').value.trim();
    if (!name || !msg || !validEmail(email)) { toast('Please complete all fields with a valid email', 'fa-circle-info'); return; }
    $('#contactName').value = ''; $('#contactEmail').value = ''; $('#contactMessage').value = '';
    toast('Message sent — we reply within one business day');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Expose internals for automated testing (harmless in production)
if (typeof module !== 'undefined') {
  module.exports = { PRODUCTS, addToCart, changeQty, cartSubtotal, shippingFor, validEmail, getCart: () => cart };
}

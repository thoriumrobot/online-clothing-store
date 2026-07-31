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
  orderLogUrl: 'https://script.google.com/macros/s/AKfycbxY4nm5q9E1TKff6SiaNNrVeB5KKegttaBHwr5UIVX2qaXlbLWOAkZaP2B-ZUzQmchR/exec',
  // Manual-transfer accounts shown at checkout — change to your real ones.
  gcash: { name: 'SAAK Store', number: '+639305314317' },
  bank:  { bank: 'BPI', name: 'SAAK Store', number: '1234 5678 90' },
  // Optional: path to your QR Ph / GCash QR image (export it from your
  // app, save e.g. as images/qrph.png). Shown at checkout so buyers can
  // scan instead of typing the account number. '' hides it.
  qrPh: '',

  // ---- Automatic GCash payment (PayMongo gateway) ----
  // Set autoGcash.enabled = true and paste your PayMongo endpoint to make
  // the GCash button redirect the buyer through GCash's real OTP/PIN flow
  // and return an automatically-confirmed payment. Funds settle to the
  // GCash/bank account registered on the PayMongo side (a gateway cannot
  // pay directly to a raw phone number — see README). Requires the tiny
  // serverless endpoint from the README (createUrl). Leave enabled=false
  // to keep the manual-reference flow.
  autoGcash: {
    enabled: false,
    createUrl: '',        // e.g. https://your-worker.workers.dev/create-gcash
    returnUrl: '',        // where GCash redirects back; '' = this page
  },
};
// Exposed for console tweaks and tests
if (typeof window !== 'undefined') window.SAAK_CONFIG = CONFIG;

// ---------- Catalog ----------
// Product data lives in scripts/products.js (edit it directly or via
// `node manage-products.js add/remove/list` from the project root).
const PRODUCTS = (typeof window !== 'undefined' && window.SAAK_PRODUCTS) || [];

const SIZED_CATEGORIES = ['tops', 'bottoms', 'outerwear'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SHIPPING_FLAT = 150;              // ₱ flat courier rate on every order

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
const shippingFor = (subtotal) => subtotal === 0 ? 0 : SHIPPING_FLAT;

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
  $('#payBtn').textContent = (selectedMethod === 'gcash' && autoGcashEnabled())
    ? `Pay ${money(orderTotal())} with GCash`
    : `I've sent ${money(orderTotal())} — place order`;
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
  // Show the owner's QR Ph code if one is configured (manual mode only)
  const hasQr = !!CONFIG.qrPh && !autoGcashEnabled();
  $('#qrBoxGcash').hidden = !hasQr;
  $('#qrBoxBank').hidden = !CONFIG.qrPh;
  if (CONFIG.qrPh) {
    $('#qrImgGcash').src = CONFIG.qrPh;
    $('#qrImgBank').src = CONFIG.qrPh;
  }
  // In auto mode the buyer pays through GCash directly — hide the manual
  // "enter your reference" input and its instructions.
  const auto = autoGcashEnabled();
  $('#gcashRef').hidden = auto;
  const gcashNote = document.querySelector('#fieldsGcash .info-note');
  if (gcashNote) gcashNote.hidden = auto;

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
  const region = $('#shipRegion').value.trim();
  const zip = $('#shipZip').value.trim();

  if (!name || !address || !region || !zip) return 'Please fill in all delivery details.';
  if (!validEmail(email)) return 'Please enter a valid email for your receipt.';

  // In automatic mode the buyer pays through GCash's own flow, so no
  // manual reference is entered — skip that check.
  if (selectedMethod === 'gcash' && !autoGcashEnabled() && !/^\d{13}$/.test($('#gcashRef').value.trim())) {
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

function shipDetails(ship) {
  // Prefer an explicitly-passed ship object (used after the auto-GCash
  // redirect, when the form fields may be empty); otherwise read the form.
  if (ship) {
    return {
      name: ship.name || '',
      address: ship.address || '',
      email: ship.email || '',
    };
  }
  return {
    name: $('#shipName').value.trim(),
    address: `${$('#shipAddress').value.trim()}, ${$('#shipRegion').value.trim()} ${$('#shipZip').value.trim()}, ${$('#shipCountry').value}`,
    email: $('#shipEmail').value.trim(),
  };
}

function buildOrderText(orderId, methodLabel, total, reference, ship) {
  const s = shipDetails(ship);
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
    `Deliver to: ${s.name}`,
    s.address,
    `Email: ${s.email}`,
  ].join('\n');
}

/* Shared success path for every payment method. `extraRows` lets a
   method add its own receipt lines (e.g. the payment reference). */
function finalizeOrder(methodLabel, total, extraRows = '', _reserved = false, reference = '', ship = null) {
  const orderId = 'SAAK-' + Date.now().toString(36).toUpperCase();
  const s = shipDetails(ship);

  // Build the order message BEFORE the cart is cleared
  lastOrderText = buildOrderText(orderId, methodLabel, total, reference, ship);

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
          name: s.name,
          address: s.address,
          email: s.email,
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

// ---------- Automatic GCash payment (PayMongo gateway) ----------
// When CONFIG.autoGcash.enabled, the GCash button hands off to a small
// serverless endpoint that creates a PayMongo GCash source and returns a
// checkout_url. We redirect the buyer there; GCash runs its own OTP + PIN
// challenge; PayMongo confirms the payment and settles to the merchant's
// registered account. On return we read ?payment=success|failed.
function autoGcashEnabled() {
  return !!(CONFIG.autoGcash && CONFIG.autoGcash.enabled && CONFIG.autoGcash.createUrl);
}

async function startAutoGcash() {
  const err = validateCheckout();
  if (err) { showError(err); return; }
  $('#checkoutError').hidden = true;
  showStep('processingStep');
  $('#processingText').textContent = 'Redirecting you to GCash…';

  // Remember the cart + shipping so we can finalize after the redirect.
  store.set('saak_pending_order', {
    total: orderTotal(),
    cart,
    ship: {
      name: $('#shipName').value.trim(),
      email: $('#shipEmail').value.trim(),
      address: `${$('#shipAddress').value.trim()}, ${$('#shipRegion').value.trim()} ${$('#shipZip').value.trim()}, ${$('#shipCountry').value}`,
    },
  });

  try {
    const res = await fetch(CONFIG.autoGcash.createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(orderTotal() * 100), // PayMongo uses centavos
        currency: 'PHP',
        description: 'SAAK order',
        return_url: (CONFIG.autoGcash.returnUrl || location.href.split('?')[0]),
      }),
    });
    if (!res.ok) throw new Error('gateway ' + res.status);
    const data = await res.json();
    const url = data.checkout_url || data.checkoutUrl || (data.attributes && data.attributes.redirect && data.attributes.redirect.checkout_url);
    if (!url) throw new Error('no checkout_url in gateway response');
    window.location.href = url; // hand off to GCash
  } catch (e) {
    showStep('checkoutStep');
    showError('Could not reach the GCash gateway. Use the manual reference below, or try again.');
  }
}

// After returning from GCash, finalize (or clear) the pending order.
function handleGcashReturn() {
  const params = new URLSearchParams(location.search);
  const outcome = params.get('payment');
  if (!outcome) return;

  const pending = store.get('saak_pending_order', null);
  // Clean the URL so a refresh doesn't re-trigger.
  history.replaceState(null, '', location.pathname);

  if (outcome === 'success' && pending) {
    cart = pending.cart || [];
    store.set('saak_pending_order', null);
    // Show the checkout modal only — opening the cart drawer here would
    // slide it out behind the confirmation.
    $('#checkoutModal').hidden = false;
    $('#checkoutModal').setAttribute('aria-hidden', 'false');
    $('#overlay').hidden = false;
    document.body.classList.add('no-scroll');
    finalizeOrder('GCash (auto)', pending.total,
      '<div class="sum-row"><span>GCash</span><span>authorization received</span></div>', false, '', pending.ship);
  } else if (outcome === 'failed') {
    store.set('saak_pending_order', null);
    toast('GCash payment was not completed. Please try again.', 'fa-circle-info');
  }
}

// If the Font Awesome CDN is blocked (data saver, ad blocker, captive
// wifi), icon-only buttons would render empty. Detect that and fall back
// to short text labels so the cart/menu stay usable.
function detectIconFont() {
  const apply = () => {
    let loaded = false;
    try {
      loaded = !!(document.fonts && (
        document.fonts.check('16px "Font Awesome 6 Free"') ||
        document.fonts.check('900 16px "Font Awesome 6 Free"')
      ));
    } catch (e) { loaded = false; }
    document.body.classList.toggle('no-icons', !loaded);
  };
  // Give the stylesheet/font a moment, then re-check once fonts settle.
  setTimeout(apply, 1200);
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(apply).catch(() => {});
  }
}

// ---------- Wiring ----------
function init() {
  renderProducts();
  renderCart();
  handleGcashReturn();
  detectIconFont();

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
  $('#payBtn').addEventListener('click', () => {
    if (selectedMethod === 'gcash' && autoGcashEnabled()) startAutoGcash();
    else placeOrder();
  });
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
    // No backend to store subscribers — open a prefilled email to the store
    // so the signup actually reaches someone instead of vanishing.
    window.location.href = 'mailto:' + CONFIG.storeEmail +
      '?subject=' + encodeURIComponent('Newsletter signup') +
      '&body=' + encodeURIComponent('Please add me to the SAAK list: ' + email);
    $('#newsletterEmail').value = '';
    toast('Opening your email app to confirm signup');
  });
  $('#contactSend').addEventListener('click', () => {
    const name = $('#contactName').value.trim();
    const email = $('#contactEmail').value.trim();
    const msg = $('#contactMessage').value.trim();
    if (!name || !msg || !validEmail(email)) { toast('Please complete all fields with a valid email', 'fa-circle-info'); return; }
    // Send through the visitor's email app to the store (no backend).
    window.location.href = 'mailto:' + CONFIG.storeEmail +
      '?subject=' + encodeURIComponent('Message from ' + name) +
      '&body=' + encodeURIComponent(msg + '\n\nReply to: ' + email);
    $('#contactName').value = ''; $('#contactEmail').value = ''; $('#contactMessage').value = '';
    toast('Opening your email app to send');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Expose internals for automated testing (harmless in production)
if (typeof module !== 'undefined') {
  module.exports = { PRODUCTS, addToCart, changeQty, cartSubtotal, shippingFor, validEmail, getCart: () => cart };
}

/* =========================================================
   SAAK — storefront logic
   Catalog rendering · search & filters · cart · checkout
   with a simulated e-wallet payment flow (front-end demo).
   ========================================================= */

// ---------- Payment configuration ----------
// PayPal runs fully client-side, so it works on static hosts like GitHub
// Pages. 'sb' uses PayPal's sandbox (test money). To go live: create a
// Business app at https://developer.paypal.com and paste its LIVE client
// ID here, then rebuild standalone.html. See README → "Real payments".
const CONFIG = {
  paypalClientId: 'sb',
  currency: 'PHP',            // Philippine Peso — supported by PayPal
  paypalSdkTimeoutMs: 12000,
};

// ---------- Catalog ----------
// Product data lives in scripts/products.js (edit it directly or via
// `node manage-products.js add/remove/list` from the project root).
const PRODUCTS = (typeof window !== 'undefined' && window.SAAK_PRODUCTS) || [];

const SIZED_CATEGORIES = ['tops', 'bottoms', 'outerwear'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const FREE_SHIPPING_THRESHOLD = 2500;   // ₱
const SHIPPING_FLAT = 150;              // ₱ standard courier rate
const COD_FEE = 50;                     // ₱ cash-handling fee
const WALLET_START_BALANCE = 20000;     // ₱ demo wallet balance

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
let walletBalance = store.get('saak_wallet_php', WALLET_START_BALANCE);
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
let selectedMethod = 'ewallet';

function orderTotal() {
  const subtotal = cartSubtotal();
  return subtotal + shippingFor(subtotal) + (selectedMethod === 'cod' ? COD_FEE : 0);
}

function renderCheckoutSummary() {
  const subtotal = cartSubtotal();
  const shipping = shippingFor(subtotal);
  const lines = cart.map((l) => {
    const p = findProduct(l.id);
    return `<div class="sum-row"><span>${l.qty} × ${p.name}${l.size ? ' (' + l.size + ')' : ''}</span><span class="mono">${money(p.price * l.qty)}</span></div>`;
  }).join('');
  const codRow = selectedMethod === 'cod'
    ? `<div class="sum-row muted"><span>Cash handling fee</span><span class="mono">${money(COD_FEE)}</span></div>` : '';
  $('#checkoutSummary').innerHTML = `
    ${lines}
    <div class="sum-row muted"><span>Shipping</span><span class="mono">${shipping === 0 ? 'Free' : money(shipping)}</span></div>
    ${codRow}
    <div class="sum-row total"><span>Total due</span><span class="mono">${money(orderTotal())}</span></div>`;
  $('#walletBalance').textContent = money(walletBalance);

  // PayPal replaces our pay button with its own
  $('#payBtn').hidden = selectedMethod === 'paypal';
  $('#payBtn').textContent = selectedMethod === 'cod' ? 'Place order' : `Pay ${money(orderTotal())}`;
  $('#checkoutFootnote').innerHTML = selectedMethod === 'paypal'
    ? '<i class="fas fa-lock"></i> PayPal handles your payment details — this site never sees them.'
    : '<i class="fas fa-lock"></i> E-wallet, card, and cash on delivery are demo methods — no real money moves.';
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
  if (selectedMethod === 'paypal') renderPayPalButtons();
}

function closeCheckout() {
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

  // PayPal collects and validates payment details in its own window.
  if (selectedMethod === 'paypal') return null;

  if (selectedMethod === 'ewallet') {
    const walletId = $('#walletId').value.trim();
    const pin = $('#walletPin').value.trim();
    if (!walletId) return 'Enter the email or phone linked to your e-wallet.';
    if (!/^\d{6}$/.test(pin)) return 'Your wallet PIN is 6 digits.';
    if (orderTotal() > walletBalance) return `Insufficient wallet balance (${money(walletBalance)}). Top up or choose another method.`;
  }

  if (selectedMethod === 'card') {
    const num = $('#cardNumber').value.replace(/\s/g, '');
    const exp = $('#cardExpiry').value.trim();
    const cvc = $('#cardCvc').value.trim();
    if (!/^\d{13,19}$/.test(num)) return 'Enter a valid card number.';
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(exp)) return 'Expiry must be MM/YY.';
    if (!/^\d{3,4}$/.test(cvc)) return 'Enter the 3–4 digit CVC.';
  }

  return null; // valid
}

/* Shared success path for every payment method. `extraRows` lets a
   gateway add its own receipt lines (e.g. a PayPal transaction ID). */
function finalizeOrder(methodLabel, total, extraRows = '', isCod = false) {
  const orderId = 'SAAK-' + Date.now().toString(36).toUpperCase();
  const email = $('#shipEmail').value.trim();

  $('#successDetail').textContent = isCod
    ? `Order placed — pay ${money(total)} to the courier on delivery. A confirmation was sent to ${email}.`
    : `${money(total)} paid via ${methodLabel}. A receipt was sent to ${email}.`;
  $('#receipt').innerHTML = `
    <div class="sum-row"><span>Order</span><span>${orderId}</span></div>
    <div class="sum-row"><span>Method</span><span>${methodLabel}</span></div>
    <div class="sum-row"><span>Total</span><span>${money(total)}</span></div>
    ${extraRows}`;

  cart = [];
  saveCart();
  renderCart();
  showStep('successStep');
}

function placeOrder() {
  const error = validateCheckout();
  if (error) { showError(error); return; }
  $('#checkoutError').hidden = true;

  const total = orderTotal();
  const method = selectedMethod;
  showStep('processingStep');
  $('#processingText').textContent =
    method === 'ewallet' ? 'Contacting your e-wallet…' :
    method === 'card' ? 'Authorizing your card…' : 'Placing your order…';

  // Simulated payment gateway round-trip (demo methods only)
  setTimeout(() => {
    let extra = '';
    if (method === 'ewallet') {
      walletBalance = Math.round((walletBalance - total) * 100) / 100;
      store.set('saak_wallet_php', walletBalance);
      extra = `<div class="sum-row"><span>Wallet balance</span><span>${money(walletBalance)}</span></div>`;
    }
    const label = method === 'ewallet' ? 'E-Wallet (SAAK Pay)' : method === 'card' ? 'Card' : 'Cash on delivery';
    finalizeOrder(label, total, extra, method === 'cod');
  }, 1600);
}

// ---------- PayPal (real third-party gateway) ----------
let paypalSdkPromise = null;

function loadPayPalSdk() {
  if (window.paypal) return Promise.resolve();
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const fail = (why) => { paypalSdkPromise = null; clearTimeout(timer); reject(new Error(why)); };
    const timer = setTimeout(() => fail('PayPal SDK timed out'), CONFIG.paypalSdkTimeoutMs);
    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' +
      encodeURIComponent(CONFIG.paypalClientId) + '&currency=' + CONFIG.currency;
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => fail('PayPal SDK failed to load');
    document.head.appendChild(s);
  });
  return paypalSdkPromise;
}

function renderPayPalButtons() {
  const box = $('#paypalButtons');
  const status = $('#paypalStatus');
  box.innerHTML = '';
  status.textContent = 'Loading PayPal…';

  loadPayPalSdk().then(() => {
    status.textContent = '';
    window.paypal.Buttons({
      // Gate PayPal's popup behind our delivery-details validation
      onClick: (data, actions) => {
        const error = validateCheckout();
        if (error) { showError(error); return actions.reject(); }
        $('#checkoutError').hidden = true;
        return actions.resolve();
      },
      createOrder: (data, actions) => actions.order.create({
        purchase_units: [{
          description: 'SAAK clothing order',
          amount: { value: orderTotal().toFixed(2), currency_code: CONFIG.currency },
        }],
      }),
      onApprove: (data, actions) => actions.order.capture().then((details) => {
        const txn = details && details.id ? details.id : data.orderID;
        finalizeOrder('PayPal', orderTotal(),
          `<div class="sum-row"><span>PayPal txn</span><span>${txn}</span></div>`);
      }),
      onError: () => showError('PayPal could not complete the payment. Try again or choose another method.'),
    }).render(box);
  }).catch(() => {
    status.textContent = '';
    showError("PayPal didn't load — check your connection, or set your client ID in scripts/main.js (see README).");
  });
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
      $('#fieldsEwallet').hidden = selectedMethod !== 'ewallet';
      $('#fieldsCard').hidden = selectedMethod !== 'card';
      $('#fieldsCod').hidden = selectedMethod !== 'cod';
      $('#fieldsPaypal').hidden = selectedMethod !== 'paypal';
      if (selectedMethod === 'paypal') renderPayPalButtons();
      renderCheckoutSummary();
    });
  });

  // Card number formatting (groups of 4)
  $('#cardNumber').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
  });
  $('#cardExpiry').addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v;
  });
  $('#walletPin').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
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

# SAAK — Online Clothing Store

A complete front-end storefront: product catalog, search & category filters,
shopping bag, and a checkout with **e-wallet**, card, and cash-on-delivery
payment options.

## Run it
Serve the folder (recommended):

    python3 -m http.server 8080
    # then visit http://localhost:8080

Or open **`standalone.html`** — the whole store in one file (styles, catalog,
logic, and images all inlined), so it displays correctly even when opened on
its own with a double-click. If `index.html` ever shows "The catalog didn't
load", it means the page was opened without its `scripts/` folder — use the
server or the standalone file. Rebuild the standalone after any change with
`node tools/build-standalone.js`.

## Manage the catalog with a script
Products live in `scripts/products.js`. Add and remove them from the
command line (run from the project root):

    node manage-products.js list
    node manage-products.js add "Wool Beanie" 22.00 accessories images/cap.svg "New"
    node manage-products.js add "Linen Shirt" 45 tops
    node manage-products.js remove p7
    node manage-products.js remove "Canvas Tote"

Add takes: name, price, category (tops / bottoms / outerwear / accessories),
then an optional image path and badge. IDs are assigned automatically,
duplicates and bad input are rejected, and the site picks up changes on the
next page load (rebuild `standalone.html` to see them there too).

## Features
- 9-product catalog with sizes, badges, category filters, and live search
- All prices in Philippine Pesos (₱) with proper thousands formatting
- Sort control (featured, price low/high, name) alongside category filters
- Cart drawer: quantity +/-, remove, subtotal, free shipping over ₱2,500,
  and a progress bar showing how close the order is to free shipping
- "Buy now" one-click path straight into checkout
- Checkout modal: delivery details + payment method selection
  - **E-Wallet (default)** — demo "SAAK Pay" wallet with a ₱20,000 starting
    balance, wallet ID + 6-digit PIN, insufficient-balance handling,
    and a receipt showing the remaining balance
  - Card — number/expiry/CVC with input formatting and validation
  - Cash on delivery — adds a ₱50.00 handling fee
- Order confirmation with order ID; cart and wallet persist via localStorage
- Toasts, empty states, Escape-to-close, keyboard focus styles,
  reduced-motion support, responsive down to mobile

## Deploying to GitHub Pages
Push the repo, then Settings → Pages → "Deploy from a branch" → `master`,
`/ (root)`. All paths are relative, so the site works under the project
subpath. After editing the catalog with `manage-products.js`, commit and
push — Pages redeploys automatically.

## Automatic GCash payment (optional)
The checkout can take **automatic GCash payments** — the buyer taps "Pay
with GCash", goes through GCash's real OTP + PIN screens, and the payment
is confirmed automatically (no manual reference typing, no waiting for you
to verify). This is **off by default**; turn it on in `scripts/main.js` →
`CONFIG.autoGcash`.

Important reality check from the research, so you set this up correctly:

- A website — especially a static one on GitHub Pages — **cannot legally
  push money into a raw GCash number** like +639305314317 by itself. GCash
  collection for a store goes through a BSP-regulated gateway (PayMongo,
  Xendit, Maya, Checkout.com, Adyen, etc.). You sign up once, and the money
  the gateway collects settles to the GCash/bank account you register with
  them. The number +639305314317 is set as the store's displayed GCash
  identity and is where you'd point settlement in your gateway dashboard.
- The gateway needs one server-side call (it uses a secret key that must
  never sit in front-end code). Because GitHub Pages has no server, deploy
  the ~20-line serverless function below to a free host (Cloudflare
  Workers, Vercel, Netlify, Deno Deploy) and put its URL in
  `CONFIG.autoGcash.createUrl`. Everything else stays on GitHub Pages.

Example Cloudflare Worker (PayMongo GCash source):

    export default {
      async fetch(req) {
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (req.method === 'OPTIONS') return new Response('', { headers: cors });
        const { amount, return_url } = await req.json();
        const r = await fetch('https://api.paymongo.com/v1/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json',
            Authorization: 'Basic ' + btoa(PAYMONGO_SECRET_KEY + ':') },
          body: JSON.stringify({ data: { attributes: {
            amount, currency: 'PHP', type: 'gcash',
            redirect: { success: return_url + '?payment=success', failed: return_url + '?payment=failed' },
          }}}),
        });
        const d = await r.json();
        return new Response(JSON.stringify({ checkout_url: d.data.attributes.redirect.checkout_url }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      },
    };

Then set in CONFIG:

    autoGcash: { enabled: true, createUrl: 'https://your-worker.workers.dev', returnUrl: '' },

**Does it work for real transactions?** Yes, once (1) you have an activated
gateway merchant account (PayMongo needs an M2/fully-verified account for
live keys), (2) the worker uses your **live** secret key, and (3) you
register your settlement account. Until then it runs against the gateway's
test mode. Confirmation is real and automatic — PayMongo fires a
`payment.paid` webhook and the buyer is redirected back with
`?payment=success`, which the site reads to complete the order.
**One caveat the research is explicit about:** the *final* success signal
should be confirmed server-side via that webhook; the redirect alone is a
good UX signal but a determined user could forge the return URL, so for
higher-value goods, verify the payment status in your gateway dashboard
before shipping.

When `autoGcash.enabled` is false, checkout uses the manual flow below.

## Payment methods: GCash + Bank transfer (InstaPay)
The checkout accepts exactly two methods, both real and both manually
verified — the standard pattern for small PH sellers without a gateway:

- **GCash** — buyer sends the exact total to your GCash account (shown at
  checkout) and enters the 13-digit reference number from their receipt.
- **Bank transfer (InstaPay)** — buyer transfers from any PH bank or
  wallet app to your bank account and enters the reference/trace number.
  InstaPay is real-time, 24/7, capped at ₱50,000 per transaction (BSP
  rule), and transfers are final and irreversible. The checkout warns
  buyers if an order exceeds the cap (use PESONet or split transfers).

Set your real accounts in `scripts/main.js` → CONFIG:

    storeEmail: 'orders@yourstore.ph',
    gcash: { name: 'Your Name', number: '09XX XXX XXXX' },
    bank:  { bank: 'BPI', name: 'Your Name', number: 'XXXX XXXX XX' },

**QR Ph at checkout (optional, recommended):** export your personal QR
from the GCash app (Pay QR → Generate) or your bank's QR Ph code, save it
as e.g. `images/qrph.png`, and set `qrPh: 'images/qrph.png'` in CONFIG.
Checkout then shows the scannable code in both payment panels — one QR Ph
code works from GCash, Maya, and 40+ participating bank apps — so buyers
scan instead of typing your number. Rebuild standalone after adding it.

**Critical verification rule:** reference numbers and receipt screenshots
can be faked. Never ship until the money is visible in your own GCash app
or bank account. The reference is for matching the incoming transfer to
the order — not proof of payment by itself.

Maya, cash on delivery, and PayPal were removed at the store owner's
request; git history has the PayPal integration if it's ever wanted back.
For automatic (non-manual) confirmation, a PH gateway (PayMongo, Xendit,
Maya Business) with a server-side component is the upgrade path.

## Manage the catalog from a smartphone
`admin.html` is a mobile catalog manager that works even though the site
is on GitHub Pages: it edits `scripts/products.js` directly in the GitHub
repository via the GitHub API, and Pages redeploys the store automatically
(~1–2 minutes per change). Setup for the trusted user:

1. On github.com: Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate. Repository access: **only this
   repository**. Permissions: **Contents → Read and write**. Nothing else.
2. Open `https://<your-pages-url>/admin.html` on the phone, paste the
   token, and connect. **Add, edit, or remove** items from the forms:
   - *Add* — fill the "Add item" form.
   - *Edit* — tap **Edit** on any item to open an inline form pre-filled
     with its current name, price, category, image, and badge; change what
     you need and tap **Save changes** (the item's ID never changes).
   - *Remove* — tap **Remove**.
   Every change is a commit, so the git log doubles as an audit trail.

**Orders on the phone:** the manager's ORDERS card shows the order list —
paste the Apps Script web-app URL and its access KEY once (saved on the
device) and it displays every logged order newest-first with items,
payment reference, delivery address (address / region / postal code), and a running order count + revenue
total, with a Refresh button. It reads the same spreadsheet the store
writes to, so remember its limit: orders only appear there if the
customer's browser successfully sent the log — the email inbox remains
the authoritative record. The key rides on the request URL over HTTPS;
treat it like a password and change it in the script to rotate it.

Security notes, honestly: `admin.html` is public but useless without a
token — all authorization is GitHub's. The token is held in the browser
(only saved to the device if "Remember" is ticked) and is sent only to
`api.github.com`. Anyone holding it can edit this repository, so share it
like a password and revoke it on GitHub if the phone is lost. The desktop
CLI (`manage-products.js`) still works and stays format-compatible.

## Where orders are stored / getting an order list
The site itself stores nothing (static hosting, no database). Orders exist
in three places:

1. **Your inbox** — every order email arrives with the subject
   `Order SAAK-XXXX`, so searching your mail for `Order SAAK-` lists all
   orders. This is the primary record for GCash/Maya/COD orders.
2. **Your PayPal dashboard** — PayPal orders appear under Activity with
   amount, buyer, and the shipped-to address; PayPal can export CSV.
3. **Optional order log (recommended)** — set `CONFIG.orderLogUrl` and the
   site also POSTs each order as JSON (id, date, method, reference, items,
   total, address, email). Point it at a Google Apps Script to collect
   every order in a spreadsheet — that spreadsheet is your order list:

   In Google Sheets: Extensions → Apps Script, paste the script below,
   change the KEY, then Deploy → Web app → access: "Anyone". Put the
   web-app URL in `orderLogUrl` (and rebuild standalone). The same URL +
   KEY also power the Orders view in `admin.html`:

       const KEY = 'change-this-secret';

       function doPost(e) {
         const o = JSON.parse(e.postData.contents);
         SpreadsheetApp.getActiveSheet().appendRow([
           o.orderId, o.date, o.method, o.reference, o.total,
           o.items.map(i => i.qty + 'x ' + i.name + (i.size ? ' (' + i.size + ')' : '')).join('; '),
           o.name, o.address, o.email, JSON.stringify(o),
         ]);
         return ContentService.createTextOutput('ok');
       }

       function doGet(e) {
         if (!e.parameter.key || e.parameter.key !== KEY) {
           return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
             .setMimeType(ContentService.MimeType.JSON);
         }
         const rows = SpreadsheetApp.getActiveSheet().getDataRange().getValues();
         const orders = rows
           .map(r => { try { return JSON.parse(r[9]); } catch (err) { return null; } })
           .filter(Boolean);
         return ContentService.createTextOutput(JSON.stringify({ orders }))
           .setMimeType(ContentService.MimeType.JSON);
       }

   Caveat: the customer's browser sends this, so treat it as convenience,
   not truth — an email or PayPal record is still the authoritative copy,
   and a blocked request (offline, ad-blocker) simply skips the log without
   affecting checkout.

## Real payments (PayPal)
The checkout includes a **PayPal** option — a real third-party gateway that
runs fully client-side, so it works on GitHub Pages with no backend. Out of
the box it uses PayPal's **sandbox** (`paypalClientId: 'sb'` in
`scripts/main.js` → CONFIG): buttons are real, money is fake. To go live:

1. Create a Business app at https://developer.paypal.com and copy its
   **Live** client ID.
2. Paste it into `CONFIG.paypalClientId` in `scripts/main.js` (currency is
   already set to `PHP` — Philippine Peso), and run
   `node tools/build-standalone.js`.
3. In your PayPal account, set **Payment Receiving Preferences** to accept
   or auto-convert PHP — otherwise, if your account doesn't hold a PHP
   balance, incoming peso payments sit as "pending" until manually accepted.
4. Test a real transaction end to end before announcing the store.

The checkout sends the customer's typed delivery address with the PayPal
order (`SET_PROVIDED_ADDRESS`), so the correct shipping address appears in
your PayPal transaction details.

Honest caveats: with a purely client-side integration the order amount is
set in the browser, so a technical buyer could tamper with their own
checkout. PayPal supports this integration style, but once real volume
matters, add server-side order creation and webhook verification (that
needs hosting with functions — Netlify/Vercel/Cloudflare — or a small API).
For direct GCash / Maya acceptance (rather than via PayPal), you'd use a
Philippine gateway such as PayMongo, Xendit, or Maya Business — all of
which require that same server-side piece.

The other checkout methods (SAAK Pay e-wallet, card, cash on delivery)
remain **simulations** — no real money moves through them. Never collect
real wallet PINs or card numbers in front-end code.

## Tests
    npm install jsdom
    npm install          # installs jsdom (test-only dependency)
    npm test             # runs all three suites (~100 checks)
    npm run build        # rebuilds standalone.html

    node test/smoke.test.js       # cart, filters, checkout, GCash + bank flows, order log
    node test/visibility.test.js  # nothing hidden renders on load; only 2 methods offered
    node test/catalog.test.js     # standalone build, CLI, peso pricing, sort, progress
    node test/admin.test.js       # smartphone add/edit/remove + orders, against a stubbed GitHub API

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

## Payment methods: GCash + Bank transfer (InstaPay) only
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
   token, and connect. Add/remove items from the forms; every change is a
   commit, so the git log doubles as an audit trail.

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

   In Google Sheets: Extensions → Apps Script, paste, then
   Deploy → Web app → access: "Anyone", and put the web-app URL in
   `orderLogUrl` (rebuild standalone after):

       function doPost(e) {
         const o = JSON.parse(e.postData.contents);
         SpreadsheetApp.getActiveSheet().appendRow([
           o.orderId, o.date, o.method, o.reference, o.total,
           o.items.map(i => i.qty + 'x ' + i.name + (i.size ? ' (' + i.size + ')' : '')).join('; '),
           o.name, o.address, o.email,
         ]);
         return ContentService.createTextOutput('ok');
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
    node test/admin.test.js       # smartphone catalog manager against a stubbed GitHub API

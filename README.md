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
- Cart drawer: quantity +/-, remove, subtotal, free shipping over $75
- "Buy now" one-click path straight into checkout
- Checkout modal: delivery details + payment method selection
  - **E-Wallet (default)** — demo "SAAK Pay" wallet with a $500 starting
    balance, wallet ID + 6-digit PIN, insufficient-balance handling,
    and a receipt showing the remaining balance
  - Card — number/expiry/CVC with input formatting and validation
  - Cash on delivery — adds a $2.00 handling fee
- Order confirmation with order ID; cart and wallet persist via localStorage
- Toasts, empty states, Escape-to-close, keyboard focus styles,
  reduced-motion support, responsive down to mobile

## Deploying to GitHub Pages
Push the repo, then Settings → Pages → "Deploy from a branch" → `master`,
`/ (root)`. All paths are relative, so the site works under the project
subpath. After editing the catalog with `manage-products.js`, commit and
push — Pages redeploys automatically.

## Real payments (PayPal)
The checkout includes a **PayPal** option — a real third-party gateway that
runs fully client-side, so it works on GitHub Pages with no backend. Out of
the box it uses PayPal's **sandbox** (`paypalClientId: 'sb'` in
`scripts/main.js` → CONFIG): buttons are real, money is fake. To go live:

1. Create a Business app at https://developer.paypal.com and copy its
   **Live** client ID.
2. Paste it into `CONFIG.paypalClientId` in `scripts/main.js`, set your
   `currency`, and run `node tools/build-standalone.js`.
3. Test a real transaction end to end before announcing the store.

Honest caveats: with a purely client-side integration the order amount is
set in the browser, so a technical buyer could tamper with their own
checkout. PayPal supports this integration style, but once real volume
matters, add server-side order creation and webhook verification (that
needs hosting with functions — Netlify/Vercel/Cloudflare — or a small API).

The other checkout methods (SAAK Pay e-wallet, card, cash on delivery)
remain **simulations** — no real money moves through them. Never collect
real wallet PINs or card numbers in front-end code.

## Tests
    npm install jsdom
    node test/smoke.test.js             # 33 checks: cart, filters, checkout, e-wallet flow
    node test/catalog.test.js           # 12 checks: standalone build, load-failure error, CLI
    node test/visibility-paypal.test.js # 20 checks: nothing hidden shows on load; PayPal flow

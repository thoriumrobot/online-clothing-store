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

## Important — payments are simulated
This is a front-end demo: no real money moves. To accept real e-wallet
payments, connect the "Pay now" step to a payment provider's API
(PayPal, Stripe, GCash, Midtrans, etc.) from a server-side backend. Never
handle real wallet PINs or card numbers directly in front-end code.

## Tests
    npm install jsdom
    node test/smoke.test.js     # 33 checks: cart, filters, checkout, e-wallet flow
    node test/catalog.test.js   # 12 checks: standalone build, load-failure error, CLI

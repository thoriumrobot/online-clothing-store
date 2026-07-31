# SAAK — Online Clothing Store

A complete front-end storefront: product catalog, search & category filters,
shopping bag, and a checkout with **e-wallet**, card, and cash-on-delivery
payment options.

## Run it
Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8080
    # then visit http://localhost:8080

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
    node test/smoke.test.js   # 33 automated checks of the full purchase flow

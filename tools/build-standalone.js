#!/usr/bin/env node
/* =========================================================
   Builds standalone.html — the entire store in ONE file.
   CSS, catalog, logic, and every image are inlined, so it
   displays correctly even when opened on its own (double-
   click, email attachment, sandboxed preview, etc.).

   Run after any change to the catalog, styles, or scripts:
     node tools/build-standalone.js
   ========================================================= */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function dataUri(rel) {
  const file = path.join(root, rel);
  if (rel.endsWith('.svg')) {
    const svg = fs.readFileSync(file, 'utf8')
      .replace(/\s+/g, ' ')
      .replace(/"/g, "'")
      .replace(/#/g, '%23');
    return `data:image/svg+xml,${svg}`;
  }
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}

let html = read('index.html');
let css = read('styles/style.css');
let products = read('scripts/products.js');
const main = read('scripts/main.js');

// Inline every catalog image as a data URI
const imageRefs = new Set(
  [...products.matchAll(/"(images\/[^"]+)"/g)].map((m) => m[1])
);
for (const rel of imageRefs) {
  products = products.split(`"${rel}"`).join(JSON.stringify(dataUri(rel)));
}

// Inline the hero background referenced from CSS
css = css.replace("url('../images/hero-image.jpg')", () => `url('${dataUri('images/hero-image.jpg')}')`);

// Swap external references for inline blocks
/* Use replacer FUNCTIONS: plain string replacements would corrupt any
   "$" sequences in the injected code ($', $&, etc. are special). */
html = html.replace(
  '<link rel="stylesheet" href="styles/style.css?v=6">',
  () => `<style>\n${css}\n    </style>`
);
html = html.replace(
  '<script src="scripts/products.js"></script>\n    <script src="scripts/main.js"></script>',
  () => `<script>\n${products}\n    </script>\n    <script>\n${main}\n    </script>`
);
html = html.replace(
  '<title>SAAK — Contemporary Clothing</title>',
  '<title>SAAK — Contemporary Clothing (standalone)</title>'
);

const out = path.join(root, 'standalone.html');
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`Built standalone.html (${kb} KB) — open it directly in any browser.`);

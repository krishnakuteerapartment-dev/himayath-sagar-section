// Copies index.html into www/ for the Android app and makes it work fully offline:
// the barcode and Excel libraries and the fonts are bundled locally instead of loaded from the internet.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('www/vendor', { recursive: true });
mkdirSync('www/fonts', { recursive: true });
copyFileSync('node_modules/@zxing/library/umd/index.min.js', 'www/vendor/zxing.min.js');
copyFileSync('node_modules/xlsx/dist/xlsx.full.min.js', 'www/vendor/xlsx.full.min.js');

// fonts (latin subset) from @fontsource
const fonts = [
  ['Barlow', 'barlow', [400, 500, 600]],
  ['Barlow Semi Condensed', 'barlow-semi-condensed', [500, 600, 700]],
  ['IBM Plex Mono', 'ibm-plex-mono', [400, 500, 600]],
  ['Share Tech Mono', 'share-tech-mono', [400]],
];
let css = '';
for (const [family, pkg, weights] of fonts) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    copyFileSync(`node_modules/@fontsource/${pkg}/files/${file}`, `www/fonts/${file}`);
    css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(${file}) format("woff2")}\n`;
  }
}
writeFileSync('www/fonts/fonts.css', css);

let html = readFileSync('index.html', 'utf8');
const swaps = [
  ['https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js', 'vendor/zxing.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'vendor/xlsx.full.min.js'],
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) throw new Error('index.html no longer references ' + from);
  html = html.split(from).join(to);
}
// Google Fonts link -> local fonts; drop the preconnects (no network needed)
const fontLink = /<link id="webfonts"[^>]*>/;
if (!fontLink.test(html)) throw new Error('index.html no longer has the webfonts link');
html = html.replace(fontLink, '<link rel="stylesheet" href="fonts/fonts.css">')
  .replace(/<link rel="preconnect"[^>]*>\n?/g, '');
writeFileSync('www/index.html', html);
console.log('www/ ready (offline: vendor libs and fonts bundled)');

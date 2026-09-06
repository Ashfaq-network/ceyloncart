import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="1" y="1" width="1198" height="628" fill="none" stroke="#21262d" stroke-width="2"/>

  <text x="70" y="110" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="42" font-weight="800" fill="#00a86b">GroceryLK</text>
  <text x="70" y="150" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="24" font-weight="400" fill="#8b949e">Sri Lanka Grocery Price Comparison</text>

  <text x="70" y="300" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="56" font-weight="800" fill="#f0f6fc">Find the <tspan fill="#00a86b">best price</tspan></text>
  <text x="70" y="370" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="56" font-weight="800" fill="#f0f6fc">on every grocery item</text>

  <g font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="21" font-weight="600" fill="#c9d1d9">
    <rect x="70" y="420" width="130" height="48" rx="10" fill="#161b22" stroke="#21262d"/>
    <text x="135" y="451" text-anchor="middle">Kapruka</text>
    <rect x="214" y="420" width="135" height="48" rx="10" fill="#161b22" stroke="#21262d"/>
    <text x="281" y="451" text-anchor="middle">Cargills</text>
    <rect x="363" y="420" width="100" height="48" rx="10" fill="#161b22" stroke="#21262d"/>
    <text x="413" y="451" text-anchor="middle">SPAR</text>
    <rect x="477" y="420" width="135" height="48" rx="10" fill="#161b22" stroke="#21262d"/>
    <text x="544" y="451" text-anchor="middle">Glomark</text>
    <rect x="626" y="420" width="115" height="48" rx="10" fill="#161b22" stroke="#21262d"/>
    <text x="683" y="451" text-anchor="middle">Arpico</text>
    <rect x="755" y="420" width="90" height="48" rx="10" fill="#161b22" stroke="#21262d"/>
    <text x="800" y="451" text-anchor="middle">GFC</text>
  </g>

  <line x1="70" y1="545" x2="1130" y2="545" stroke="#21262d" stroke-width="2"/>
  <text x="70" y="585" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="26" fill="#8b949e">Compare <tspan fill="#00a86b" font-weight="700">6 stores</tspan>  |  updated <tspan fill="#00a86b" font-weight="700">daily</tspan></text>
  <rect x="940" y="552" width="190" height="46" rx="23" fill="#1b2e26" stroke="#00a86b"/>
  <text x="1035" y="582" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="18" font-weight="600" fill="#00a86b" text-anchor="middle">grocerylk.vercel.app</text>
</svg>`

const sharp = (await import('sharp')).default
writeFileSync(join(PROJECT_ROOT, 'client/public/og-image.png'), await sharp(Buffer.from(svg)).png().toBuffer())
console.log('wrote client/public/og-image.png')
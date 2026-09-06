import express from 'express';
import cors from 'cors';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getDb, initDb, getCachedSearch, setCachedSearch, getCacheStats, recordEvent, getAnalyticsSummary, getCachedCategory, setCachedCategory } from './db.js';
import { cleanName, formatPrice } from './utils.js';
import { searchGlomark, normalizeGlomark } from './glomark-connector.js';
import { searchArpico } from './arpico-connector.js';
import { SEO_PAGES, CATEGORIES, STORE_META, STORE_SUBPAGES, SI_PAGES } from './seo.js';

// ─── Scraped data from GitHub Actions ───
const SCRAPED_STORES = ['gfc', 'cargills']

async function getScrapedResults(store, query) {
  try {
    const db = getDb()
    if (!db) return null
    const row = await db.execute({
      sql: `SELECT data FROM scraped_data WHERE store = ? AND query = ?`,
      args: [store, query.toLowerCase().trim()],
    }).then(r => r.rows[0])
    if (!row) return null
    return JSON.parse(row.data)
  } catch { return null }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.API_KEY || 'bf86aa4a89c343c216927904ab3f11da2b876d8b06ece2e3'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'grocerylk2024'
const ALLOWED_ORIGINS = [
  'https://grocerylk.vercel.app',
  /^https:\/\/grocerylk-.*\.vercel\.app$/,
  'http://localhost:3001',
  'http://localhost:5173',
]

const app = express();
const corsOpts = {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o.test(origin))) {
      cb(null, true)
    } else {
      cb(null, false)
    }
  },
  credentials: true,
}
app.use(cors(corsOpts))
app.options('*', cors(corsOpts))
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

// ─── Rate limiting ───
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

app.use('/api/search', generalLimiter)
app.use('/api/homepage', generalLimiter)
app.use('/api/categories', generalLimiter)
app.use('/api/analytics', strictLimiter)
app.use('/api/analytics/dashboard', strictLimiter)

// ─── API key check (image/analytics endpoints excluded since they need to work without headers) ───
app.use('/api', (req, res, next) => {
  const exempt = ['/myip', '/analytics', '/product-image', '/indexnow']
  if (exempt.some(p => req.path.startsWith(p))) return next()
  const key = req.headers['x-api-key'] || req.query.api_key
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

// ─── Store registry ───
const STORES = {
  kapruka: { name: 'Kapruka', icon: '🛒', orderable: true, deliveryFee: 250, freeDeliveryMin: 5000 },
  gfc: { name: 'Global Food City', icon: '🏪', orderable: false, deliveryFee: 350, freeDeliveryMin: 3000 },
  spar: { name: 'SPAR', icon: '🛍️', orderable: false, deliveryFee: 300, freeDeliveryMin: 3000 },
  glomark: { name: 'Glomark', icon: '🛒', orderable: false, deliveryFee: 0, freeDeliveryMin: 0 },
  arpico: { name: 'Arpico', icon: '🏪', orderable: false, deliveryFee: 0, freeDeliveryMin: 0 },
  cargills: { name: 'Cargills', icon: '🏪', orderable: false, deliveryFee: 0, freeDeliveryMin: 0 },
};

// ─── Kapruka MCP connector ───
let mcpClient;
let lastConnected = 0;
const RECONNECT_INTERVAL = 60000;

async function getKaprukaClient() {
  const now = Date.now();
  if (mcpClient && (now - lastConnected) < RECONNECT_INTERVAL) return mcpClient;
  const transport = new StreamableHTTPClientTransport('https://mcp.kapruka.com/mcp');
  const client = new Client({ name: 'pricespot', version: '1.0.0' });
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Kapruka MCP timeout')), 8000)),
  ]);
  mcpClient = client;
  lastConnected = now;
  return client;
}

async function kaprukaCall(name, args) {
  const client = await getKaprukaClient();
  const result = await client.callTool({ name, arguments: { params: { ...args, response_format: 'json' } } });
  const text = result.content?.[0]?.text;
  if (!text) throw new Error('No response from Kapruka');
  try { return JSON.parse(text); } catch { return text; }
}

function normalizeKapruka(raw) {
  const results = (raw.results || []).map(p => ({
    id: `kapruka:${p.id}`,
    originalId: p.id,
    name: cleanName(p.name),
    store: 'kapruka',
    storeName: STORES.kapruka.name,
    price: p.price?.amount || 0,
    priceFormatted: p.price?.formatted || formatPrice(p.price?.amount || 0),
    currency: 'LKR',
    image: p.image || '',
    url: p.url || '',
    inStock: p.in_stock !== false,
    category: typeof p.category === 'object' ? p.category?.name || '' : p.category || '',
    sku: p.sku || '',
  }));
  return { results, total: raw.total_matched || results.length };
}

// ─── Global Food City WooCommerce connector ───
const GFC_BASE = 'https://globalfoodcity.com/wp-json/wc/store/v1';

async function searchGFC(query, opts = {}) {
  const params = new URLSearchParams({ search: query, per_page: String(opts.limit || 20) });
  if (opts.cursor) params.set('page', opts.cursor);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${GFC_BASE}/products?${params}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        'Referer': 'https://globalfoodcity.com/',
      },
    });
    if (!res.ok) throw new Error(`GFC API error: ${res.status}`);
    const data = await res.json();
    const total = parseInt(res.headers.get('x-wp-total') || '0');
    return { raw: Array.isArray(data) ? data : [], total };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGFC(products) {
  const results = products.map(p => {
    const minorUnit = p.prices?.currency_minor_unit || 2;
    const rawPrice = parseInt(p.prices?.price || '0');
    const price = rawPrice / Math.pow(10, minorUnit);
    return {
      id: `gfc:${p.id}`,
      originalId: p.id,
      name: cleanName(p.name),
      store: 'gfc',
      storeName: STORES.gfc.name,
      price,
      priceFormatted: formatPrice(price),
      currency: 'LKR',
      image: p.images?.[0]?.thumbnail || p.images?.[0]?.src || '',
      url: p.permalink || '',
      inStock: p.is_in_stock === true,
      category: p.categories?.map(c => c.name).join(', ') || '',
      sku: p.sku || '',
    };
  });
  return { results, total: results.length };
}

// ─── SPAR (Shopify) connector ───
const SPAR_BASE = 'https://spar2u.lk';

async function searchSPAR(query, opts = {}) {
  const params = new URLSearchParams({
    q: query,
    'resources[type]': 'product',
    limit: String(opts.limit || 20),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${SPAR_BASE}/search/suggest.json?${params}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`SPAR API error: ${res.status}`);
    const data = await res.json();
    return data.resources?.results?.products || [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSPAR(products) {
  const results = products.map(p => {
    const price = parseFloat(p.price) || 0;
    return {
      id: `spar:${p.id}`,
      originalId: p.id,
      name: cleanName(p.title),
      store: 'spar',
      storeName: STORES.spar.name,
      price,
      priceFormatted: formatPrice(price),
      currency: 'LKR',
      image: p.image || p.featured_image?.url || '',
      url: `${SPAR_BASE}${(p.url || '').split('?')[0]}`,
      inStock: p.available !== false,
      category: p.type || p.tags?.join(', ') || '',
      sku: '',
    };
  });
  return { results, total: results.length };
}

// ─── Helpers ───
// cleanName and formatPrice imported from ./utils.js

// ─── Product matching ───
const KNOWN_BRANDS = new Set([
  'cic', 'daawat', 'prima', 'araliya', 'nipuna', 'ariya', 'keells', 'spar', 'maggi',
  'nestle', 'unilever', 'dilmah', 'lipton', 'coca', 'pepsi', 'elephant', 'house',
  'fortuna', 'golden', 'crop', 'munchee', 'maliban', 'tipitip', 'kotmale', 'anchor',
  'lakspray', 'cargills', 'jayasri', 'lagro', 'rose', 'challenge', 'jayadi', 'mavee',
  'orient', 'savemor', 'banno', 'catch', 'alli', 'serendib', 'pigeon', 'glad',
  'lifebuoy', 'sunlight', 'vim', 'lux', 'clogard', 'signal', 'colgate',
  'palmolive', 'dove', 'rexona', 'rin', 'surf', 'tide', 'ariel', 'omo',
  'ambalaya', 'samaposha', 'kist', 'pure', 'crispy', 'mac', 'vanilla',
  'roma', 'kottu', 'pandaroo', 'yumart',
]);

const PRODUCT_TYPES = new Set([
  'flour', 'oil', 'sugar', 'dhal', 'spice', 'spices', 'tea',
  'milk', 'powder', 'soap', 'shampoo', 'detergent', 'lotion', 'cream', 'paste',
  'salt', 'noodles', 'pasta', 'biscuit', 'chocolate', 'drink', 'juice', 'water',
  'tuna', 'fish', 'chicken', 'meat', 'egg', 'butter', 'cheese', 'yogurt',
  'toothpaste', 'brush', 'tissue', 'paper', 'cleaner', 'cooking',
  'string', 'hopper', 'bread', 'chilli', 'turmeric', 'cumin', 'pepper',
  'onion', 'potato', 'tomato', 'carrot', 'lemon', 'coconut', 'banana',
  'noodles', 'vermicelli', 'flakes', 'mixture', 'sauce', 'pickle', 'achcharu',
  'jam', 'honey', 'syrup', 'ketchup', 'mayonnaise', 'dressing', 'vinegar',
]);

const RICE_VARIETIES = new Set([
  'rice', 'basmathi', 'basmati', 'nadu', 'samba', 'keeri', 'surduru',
  'suduru', 'kaluheenati', 'kuruluthuda', 'raw', 'red', 'white', 'brown',
]);

function parseQty(name) {
  const m = (name || '').toLowerCase().match(/(\d+\.?\d*)\s*(kg|kilo|kgs|g|gram|grams|l|litre|litres|ml|millilitre|lb|oz|pack|pcs|pieces?|box|bottle|can|sachet|bag)\b/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  let unit = m[2].replace(/s$/, '');
  if (unit === 'kg' || unit === 'kilo' || unit === 'kgs') { val *= 1000; unit = 'g'; }
  if (unit === 'litre' || unit === 'litres') { val *= 1000; unit = 'ml'; }
  if (unit === 'lb') { val *= 453.59; unit = 'g'; }
  if (unit === 'oz') { val *= 28.35; unit = 'g'; }
  if (unit === 'pcs' || unit === 'pieces' || unit === 'piece') unit = 'pcs';
  if (unit === 'box') unit = 'pcs';
  if (unit === 'bag') unit = 'pcs';
  return { value: val, unit };
}

function qtyMatch(qa, qb) {
  if (!qa || !qb) return null;
  if (qa.unit !== qb.unit) return false;
  const max = Math.max(qa.value, qb.value);
  const min = Math.min(qa.value, qb.value);
  if (min === 0) return null;
  return max / min;
}

function matchProducts(products) {
  const indexed = products.map(p => {
    const name = (p.name || '').toLowerCase();
    const words = name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));

    const qty = parseQty(name);
    const cleanTokens = words.filter(w => !/^(kg|g|ml|l|lb|oz|kgs|per|bulk|each)$/.test(w));

    const brand = cleanTokens.find(t => KNOWN_BRANDS.has(t)) || '';

    const ptype = cleanTokens.filter(t => PRODUCT_TYPES.has(t));

    const variety = cleanTokens.filter(t => RICE_VARIETIES.has(t));

    return { ...p, _qty: qty, _brand: brand, _type: ptype, _variety: variety, _words: cleanTokens, _store: p.store };
  });

  const groups = [];
  const used = new Set();

  for (let i = 0; i < indexed.length; i++) {
    if (used.has(i)) continue;
    const group = [indexed[i]];
    used.add(i);

    for (let j = i + 1; j < indexed.length; j++) {
      if (used.has(j)) continue;
      const a = indexed[i];
      const b = indexed[j];

      if (a._store === b._store) continue;

      const qm = qtyMatch(a._qty, b._qty);
      if (qm === false) continue;

      let score = 0;

      if (a._brand && b._brand && a._brand === b._brand) score += 0.3;

      const varOverlap = a._variety.filter(t => b._variety.includes(t));
      if (varOverlap.length > 0) score += 0.3;

      const typeOverlap = a._type.filter(t => b._type.includes(t));
      if (typeOverlap.length > 0) score += 0.2;

      if (a._qty && b._qty && a._qty.unit === b._qty.unit) score += 0.05;

      const stop = new Set(['per', 'bulk', 'each', 'imp', 'local', 'new', 'premium', 'special']);
      const aRemaining = a._words.filter(w =>
        w !== a._brand && !a._type.includes(w) && !a._variety.includes(w) && !stop.has(w)
      );
      const bRemaining = b._words.filter(w =>
        w !== b._brand && !b._type.includes(w) && !b._variety.includes(w) && !stop.has(w)
      );
      const union = new Set([...aRemaining, ...bRemaining]);
      if (union.size > 0) {
        const inter = aRemaining.filter(w => bRemaining.includes(w));
        score += 0.3 * (inter.length / union.size);
      }

      const aOnlyType = a._type.filter(t => !b._type.includes(t));
      const bOnlyType = b._type.filter(t => !a._type.includes(t));
      const aOnlyVar = a._variety.filter(t => !b._variety.includes(t));
      const bOnlyVar = b._variety.filter(t => !a._variety.includes(t));
      const asymPenalty = (aOnlyType.length + bOnlyType.length + aOnlyVar.length + bOnlyVar.length) * 0.2;
      score = Math.max(0, score - asymPenalty);

      if (aRemaining.length > 0 && bRemaining.length > 0) {
        const inter = aRemaining.filter(w => bRemaining.includes(w));
        if (inter.length === 0) score = Math.max(0, score - 0.25);
      }

      if (typeof qm === 'number' && qm > 1.1) {
        score *= Math.max(0.4, 1 - (qm - 1.1) * 0.3);
      }

      if (a.price > 0 && b.price > 0) {
        const ratio = Math.max(a.price, b.price) / Math.min(a.price, b.price);
        if (ratio > 5) score *= 0.3;
        else if (ratio > 3) score *= 0.5;
        else if (ratio > 2) score *= 0.75;
      }

      if (score >= 0.45) {
        group.push(b);
        used.add(j);
      }
    }
    groups.push(group);
  }

  return groups;
}

// ─── Kapruka image scraper ───
const kaprukaImageCache = new Map();
const KAPRUKA_IMG_CACHE_MAX = 500;

async function fetchKaprukaImage(productId, productUrl) {
  if (kaprukaImageCache.has(productId)) return kaprukaImageCache.get(productId);
  try {
    const res = await fetch(productUrl, { signal: AbortSignal.timeout(5000) });
    const html = await res.text();
    const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const url = match ? match[1] : '';
    if (kaprukaImageCache.size >= KAPRUKA_IMG_CACHE_MAX) {
      const firstKey = kaprukaImageCache.keys().next().value
      if (firstKey) kaprukaImageCache.delete(firstKey)
    }
    kaprukaImageCache.set(productId, url);
    return url;
  } catch {
    return '';
  }
}

app.get('/api/product-image/:store/:id', async (req, res) => {
  try {
    const { store, id } = req.params;
    const productUrl = req.query.url || '';
    if (store !== 'kapruka') return res.status(400).json({ error: 'Only Kapruka supported' });
    if (!productUrl) return res.status(400).json({ error: 'Missing url param' });
    const url = await fetchKaprukaImage(id, productUrl);
    if (url) return res.redirect(url);
    res.status(404).json({ error: 'No image found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Store Health Tracking ───
const STORE_PRIORITY = ['kapruka', 'spar', 'glomark', 'arpico', 'gfc', 'cargills']

async function getStoreHealth() {
  try {
    const db = getDb()
    if (!db) return {}
    const row = await db.execute({
      sql: `SELECT value FROM cached_data WHERE key = 'store_health'`
    })
    if (row.rows.length > 0) return JSON.parse(row.rows[0].value)
  } catch {}
  return {}
}

async function updateStoreHealth(storeId, success) {
  try {
    const db = getDb()
    if (!db) return
    const health = await getStoreHealth()
    const now = Date.now()
    const entry = health[storeId] || { successes: 0, failures: 0, lastCheck: 0, healthy: true }
    entry.lastCheck = now
    if (success) {
      entry.successes++
      entry.failures = 0
      entry.healthy = true
    } else {
      entry.failures++
      entry.healthy = entry.failures < 5
    }
    health[storeId] = entry
    await db.execute({
      sql: `INSERT OR REPLACE INTO cached_data (key, value) VALUES ('store_health', ?)`,
      args: [JSON.stringify(health)]
    })
  } catch {}
}

function getAutoStores(health, fast) {
  const all = Object.keys(STORES)
  if (Object.keys(health).length === 0) {
    const preferred = fast ? ['kapruka', 'spar', 'glomark'] : all
    return preferred.filter(s => STORES[s])
  }
  const healthy = all.filter(id => health[id] ? health[id].healthy !== false : true)
  if (fast) {
    const result = healthy.filter(s => STORE_PRIORITY.indexOf(s) <= STORE_PRIORITY.indexOf('glomark'))
    return result.length > 0 ? result : healthy
  }
  return healthy.length > 0 ? healthy : all
}

// ─── Search all stores helper with auto health tracking ───
async function searchAllStores(query, opts = {}) {
  const { limit = 30, sort = '', cursor = null, category = null, stores = null, fast = false } = opts
  
  let activeStores
  if (stores && stores.length > 0) {
    activeStores = stores
  } else {
    const health = await getStoreHealth()
    activeStores = getAutoStores(health, fast)
  }
  
  const searches = []
  const trackHealth = !(stores && stores.length > 0)

  function tracked(storeId, fn) {
    const promise = fn()
    if (!trackHealth) {
      return promise.catch(e => ({ results: [], total: 0, _error: e.message }))
    }
    return promise
      .then(r => { updateStoreHealth(storeId, true); return r })
      .catch(e => { updateStoreHealth(storeId, false); return { results: [], total: 0, _error: e.message } })
  }

  if (activeStores.includes('kapruka')) {
    searches.push(
      tracked('kapruka', () =>
        kaprukaCall('kapruka_search_products', {
          q: query, category: category || null, limit,
          sort: sort || 'relevance', cursor: cursor || null,
        }).then(normalizeKapruka)
      )
    )
  }

  async function withScrapeFallback(storeId, liveFn) {
    try {
      const scraped = await getScrapedResults(storeId, query)
      if (scraped && scraped.results && scraped.results.length > 0) {
        return scraped
      }
    } catch {}
    return tracked(storeId, liveFn)
  }

  if (activeStores.includes('gfc')) {
    searches.push(
      withScrapeFallback('gfc', () =>
        searchGFC(query, { limit, cursor })
          .then(({ raw }) => normalizeGFC(raw))
      )
    )
  }

  if (activeStores.includes('cargills')) {
    searches.push(
      withScrapeFallback('cargills', () =>
        Promise.reject(new Error('Cargills blocked on Vercel'))
      )
    )
  }

  if (activeStores.includes('spar')) {
    searches.push(
      tracked('spar', () =>
        searchSPAR(query, { limit })
          .then(normalizeSPAR)
      )
    )
  }

  if (activeStores.includes('glomark')) {
    searches.push(
      tracked('glomark', () =>
        searchGlomark(query, { limit })
          .then(({ products }) => normalizeGlomark(products, STORES.glomark.name))
      )
    )
  }

  if (activeStores.includes('arpico')) {
    searches.push(
      tracked('arpico', () =>
        searchArpico(query, { limit })
      )
    )
  }

  const allResults = await Promise.all(searches)
  const merged = allResults.flatMap(r => r.results)

  merged.sort((a, b) => {
    if (sort === 'price_asc') return a.price - b.price
    if (sort === 'price_desc') return b.price - a.price
    return 0
  })

  const matched = matchProducts(merged)
  const total = allResults.reduce((s, r) => s + r.total, 0)

  return { merged, matched, total }
}

// ─── API Routes ───

app.get('/api/stores', (req, res) => {
  res.json({ stores: Object.entries(STORES).map(([k, v]) => ({ id: k, ...v })) });
});

app.get('/api/cache/stats', async (req, res) => {
  try { res.json(await getCacheStats()); } catch (e) { res.status(500).json({ error: 'Internal error' }); }
});

function normalizeQuery(query) {
  return query.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const HOMEPAGE_SECTIONS = {
  featured: ['rice', 'dhal', 'milk', 'eggs', 'bread', 'sugar'],
  new: ['snacks', 'chocolate', 'drinks', 'biscuits', 'cereal'],
  bestsellers: ['dilmah', 'nestle', 'maggi', 'prima', 'soap'],
  suggested: ['fruits', 'chicken', 'cheese', 'butter', 'curry'],
};

app.get('/api/homepage', async (req, res) => {
  const db = getDb()
  if (db) {
    const cached = await db.execute({
      sql: `SELECT value FROM cached_data WHERE key = 'homepage_v3' AND updated_at > datetime('now', '-4 hours')`,
    }).then(r => r.rows[0]).catch(() => null)
    if (cached) return res.json(JSON.parse(cached.value))
  }

  const result = {};
  const globalSeen = new Set();
  const MAX_PER_SECTION = 20;

  const ALL_STORES = Object.keys(STORES);
  const sectionPromises = Object.entries(HOMEPAGE_SECTIONS).map(async ([section, queries]) => {
    const sectionProducts = [];
    const queryPromises = queries.map(q =>
      searchAllStores(q, { limit: 6, stores: ALL_STORES })
        .then(r => r.merged)
        .catch(() => [])
    );
    const allResults = await Promise.allSettled(queryPromises);

    for (const r of allResults) {
      if (r.status !== 'fulfilled') continue;
      for (const p of r.value) {
        const key = `${p.store}-${p.originalId || p.name}`;
        if (!globalSeen.has(key) && sectionProducts.length < MAX_PER_SECTION) {
          globalSeen.add(key);
          sectionProducts.push(p);
        }
      }
    }
    result[section] = sectionProducts;
  });

  await Promise.all(sectionPromises);

  if (db) {
    try {
      await db.execute({
        sql: `INSERT OR REPLACE INTO cached_data (key, value, updated_at) VALUES ('homepage_v3', ?, datetime('now'))`,
        args: [JSON.stringify({ sections: result })],
      });
    } catch {}
  }

  res.json({ sections: result });
});

app.get('/api/search', async (req, res) => {
  try {
    const { q, category, limit, sort, cursor, stores: storeFilter, skipCache, fast } = req.query;
    const query = (q || '').trim();
    if (!query) return res.json({ results: [], matched: [], total: 0, query: '', stores: Object.keys(STORES) });

    const maxResults = parseInt(limit, 10) || 30;
    const isFast = fast === 'true'
    const activeStores = storeFilter ? storeFilter.split(',') : (isFast ? null : Object.keys(STORES));

    const normalizedQuery = normalizeQuery(query);
    const sortParam = sort || '';

    const skip = skipCache === 'true' || skipCache === true

    if (category && !skip) {
      const catCached = await getCachedCategory(category);
      if (catCached) return res.json(catCached);
    }

    if (!skip && activeStores && activeStores.length > 0) {
      const cached = await getCachedSearch(normalizedQuery, activeStores, sortParam);
      if (cached) return res.json(cached);
    }

    let merged, matched, total;
    const initial = await searchAllStores(query, {
      limit: maxResults, sort, cursor, category, stores: activeStores, fast: isFast,
    });
    merged = initial.merged;
    matched = initial.matched;
    total = initial.total;

    if (category && total < 3) {
      const fallback = await searchAllStores(query, {
        limit: maxResults, sort, cursor, category, stores: ['kapruka'],
      });
      if (fallback.total > total) {
        merged = fallback.merged;
        matched = fallback.matched;
        total = fallback.total;
      }
    }

    if (category && total < 3) {
      const catCached = await getCachedCategory(category);
      if (catCached) return res.json(catCached);
    }

    // Record prices for history (async, non-blocking)
    const histDb = getDb();
    if (histDb) {
      Promise.allSettled(
        merged.slice(0, 50).map(p =>
          histDb.execute({
            sql: `INSERT OR IGNORE INTO price_history (product_key, store, price, currency, recorded_at) VALUES (?, ?, ?, ?, datetime('now'))`,
            args: [`${p.store}:${p.originalId || p.id}`, p.store, p.price, p.currency || 'LKR'],
          })
        )
      ).catch(() => {});
    }

    const response = {
      results: merged.slice(0, Math.max(maxResults * 3, 60)),
      matched,
      total,
      query,
      stores: Object.keys(STORES),
    };

    if (category && total >= 3) {
      setCachedCategory(category, response);
    }

    await setCachedSearch(normalizedQuery, activeStores, sortParam, response);

    res.json(response);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/product/:id', async (req, res) => {
  try {
    const [store, originalId] = req.params.id.split(':');
    if (store === 'kapruka') {
      const data = await kaprukaCall('kapruka_get_product', { product_id: originalId });
      return res.json(normalizeKapruka({ results: [data] }));
    }
    if (store === 'gfc') {
      const resp = await fetch(`${GFC_BASE}/products/${originalId}`);
      if (!resp.ok) throw new Error('Not found');
      const p = await resp.json();
      return res.json(normalizeGFC([p]));
    }
    if (store === 'spar') {
      const url = req.query.url || `${SPAR_BASE}/products/${originalId}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Not found');
      const html = await resp.text();
      const title = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] || '';
      const price = parseFloat(html.match(/<meta\s+property="product:price:amount"\s+content="([^"]+)"/i)?.[1] || '0');
      const image = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] || '';
      return res.json({
        results: [{
          id: `spar:${originalId}`, originalId, name: cleanName(title),
          store: 'spar', storeName: STORES.spar.name,
          price, priceFormatted: formatPrice(price), currency: 'LKR',
          image, url, inStock: true, category: '', sku: '',
        }],
        total: 1,
      });
    }
    res.status(400).json({ error: 'Unknown store' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const data = await kaprukaCall('kapruka_list_categories', {
      depth: parseInt(req.query.depth, 10) || 1,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let citiesCache = null, citiesCacheTime = 0
const CITIES_CACHE_TTL = 3600000

async function fetchAllCities() {
  if (citiesCache && Date.now() - citiesCacheTime < CITIES_CACHE_TTL) return citiesCache
  const db = getDb()
  if (db) {
    try {
      try { await initDb() } catch {}
      const row = await db.execute(`SELECT value FROM cached_data WHERE key = 'cities_v2'`).then(r => r.rows[0])
      if (row?.value) {
        const parsed = JSON.parse(row.value)
        if (Array.isArray(parsed)) { citiesCache = parsed; citiesCacheTime = Date.now(); return parsed }
      }
    } catch {}
  }
  const all = [], seen = new Set()
  const letters = 'abcdefghijklmnopqrstuvwxyz'

  for (const ch of letters) {
    try {
      const data = await kaprukaCall('kapruka_list_delivery_cities', { query: ch, limit: 50 })
      const list = data.cities || []
      for (const c of list) {
        const key = c.name?.toLowerCase().trim() || ''
        if (key && !seen.has(key)) { seen.add(key); all.push(c) }
      }
    } catch {}
  }

  for (const extra of ['we', 'wel', 'well', 'ko', 'kol', 'ne', 'ra', 'ha', 'ma', 'ka', 'pa', 'ba', 'ga', 'da', 'ta', 'th', 'na', 'la', 'sa', 'ja', 'ke', 'ki', 'ku', 'mi', 'mu', 'mo']) {
    try {
      const data = await kaprukaCall('kapruka_list_delivery_cities', { query: extra, limit: 50 })
      const list = data.cities || []
      for (const c of list) {
        const key = c.name?.toLowerCase().trim() || ''
        if (key && !seen.has(key)) { seen.add(key); all.push(c) }
      }
    } catch {}
  }

  citiesCache = all
  citiesCacheTime = Date.now()
  if (db) {
    try { await db.execute({ sql: `INSERT OR REPLACE INTO cached_data (key, value) VALUES ('cities_v2', ?)`, args: [JSON.stringify(all)] }) } catch {}
  }
  return all
}

app.get('/api/cities', async (req, res) => {
  try {
    const cities = await fetchAllCities()
    res.json({ cities, total_matched: cities.length })
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/check-delivery', async (req, res) => {
  try {
    const { city, delivery_date, product_id } = req.body;
    const data = await kaprukaCall('kapruka_check_delivery', {
      city, delivery_date: delivery_date || null, product_id: product_id || null,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/create-order', async (req, res) => {
  try {
    const { cart, recipient, delivery, sender, gift_message, currency } = req.body;
    const data = await kaprukaCall('kapruka_create_order', {
      cart, recipient, delivery, sender,
      gift_message: gift_message || null, currency: currency || 'LKR',
    });
    if (typeof data === 'string') throw new Error(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/track-order/:orderNumber', async (req, res) => {
  try {
    const data = await kaprukaCall('kapruka_track_order', {
      order_number: req.params.orderNumber,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/price-history', async (req, res) => {
  try {
    const { product_key, store, days } = req.query;
    if (!product_key) return res.status(400).json({ error: 'product_key required' });
    const limit = parseInt(days) || 30;
    const histDb = getDb();
    if (!histDb) return res.json({ history: [] });
    const rows = await histDb.execute({
      sql: `SELECT price, currency, recorded_at FROM price_history WHERE product_key = ? AND recorded_at >= datetime('now', '-' || ? || ' days') ORDER BY recorded_at ASC`,
      args: [product_key, limit],
    }).then(r => r.rows);
    res.json({ history: rows, product_key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Analytics ───
app.post('/api/analytics', async (req, res) => {
  try {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const { type, session_id, data } = body || {}
    if (!type) return res.status(400).json({ error: 'type required' })
    const country = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || ''
    await recordEvent(type, session_id, data, req.ip, req.headers['user-agent'], country)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ ok: false }) }
})

app.get('/api/analytics/dashboard', async (req, res) => {
  try { res.json(await getAnalyticsSummary(req.query.exclude_ip)) } catch (e) { res.json({}) }
})

app.get('/api/store-health', async (req, res) => {
  try {
    const health = await getStoreHealth()
    res.json({ stores: Object.keys(STORES), health })
  } catch { res.json({ stores: Object.keys(STORES), health: {} }) }
})

// ─── Admin dashboard page ───
app.get('/api/myip', (req, res) => res.json({ ip: req.ip }));

app.get('/admin', (req, res, next) => {
  const pw = req.query.pw
  if (pw !== ADMIN_PASSWORD) {
    return res.type('html').send(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin</title><style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}form{background:#161b22;padding:32px;border-radius:8px;border:1px solid #30363d}input{display:block;width:100%;padding:10px;margin:12px 0;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#fff;font-size:16px}button{width:100%;padding:10px;background:#00a86b;border:none;border-radius:6px;color:#fff;font-size:16px;cursor:pointer}h2{margin:0 0 8px}</style></head><body><form method="GET" action="/admin"><h2>Admin Login</h2><input type="password" name="pw" placeholder="Password" autofocus/><button type="submit">Enter</button></form></body></html>'
    )
  }
  next()
})

app.get('/admin', (req, res) => {
  res.type('html').send(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>GroceryLK Analytics</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:40px 24px;max-width:800px;margin:0 auto}' +
    'h1{font-size:24px;margin-bottom:8px;color:#00a86b}' +
    '.sub{font-size:13px;color:#8b949e;margin-bottom:32px}' +
    '.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:16px}' +
    '.card h2{font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;margin-bottom:12px}' +
    '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}' +
    '.big-stat{text-align:center;padding:24px;background:#0d1117;border:2px solid #00a86b;border-radius:8px;margin-bottom:16px}' +
    '.big-stat-value{font-size:48px;font-weight:700;color:#00a86b}' +
    '.big-stat-label{font-size:13px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:1px}' +

    '.stat{text-align:center;padding:16px;background:#0d1117;border:1px solid #30363d;border-radius:6px}' +
    '.stat-value{font-size:28px;font-weight:700;color:#f0f6fc}' +
    '.stat-label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}' +
    '</style></head><body>' +
    '<h1>GroceryLK</h1><p class="sub">Analytics Dashboard</p>' +
    '<div id="app"><p style="text-align:center;padding:60px;color:#8b949e;font-size:14px">Loading...</p></div>' +
    '<script>' +
    'var myIp=localStorage.getItem("myip")||"";' +
    'if(!myIp){fetch("/api/myip").then(function(r){return r.json()}).then(function(d){myIp=d.ip;loadData()}).catch(function(){loadData()})}else{loadData()}' +
    'function loadData(){fetchData()}' +
    'function fetchData(){' +
    'var url="/api/analytics/dashboard";' +
    'if(myIp)url+="?exclude_ip="+encodeURIComponent(myIp);' +
    'fetch(url).then(function(r){return r.json()}).then(function(d){' +
    'var maxQ=d.topQueries&&d.topQueries.length?Math.max.apply(null,d.topQueries.map(function(x){return x.c})):1;' +
    'var maxU=d.dailyUnique&&d.dailyUnique.length?Math.max.apply(null,d.dailyUnique.map(function(x){return x.c})):1;' +
    'var html=' +
    '"<div style=\\"margin-bottom:20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap\\"><span style=\\"font-size:12px;color:#8b949e\\">Your IP:</span><input id=\\"ipInput\\" value=\\""+myIp+"\\" style=\\"padding:6px 10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:13px;width:160px\\" placeholder=\\"Enter your IP\\"/><button onclick=\\"saveIp()\\" style=\\"padding:6px 14px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:12px;cursor:pointer\\">Exclude me</button><span style=\\"font-size:11px;color:#555\\">(reloads chart)</span></div>" +' +
    '"<div class=\\"big-stat\\"><div class=\\"big-stat-value\\">"+d.todayVisitors+"</div><div class=\\"big-stat-label\\">Real People Today</div></div>" +' +
    '"<div class=\\"card\\"><div class=\\"stats\\">" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalVisits+"</div><div class=\\"stat-label\\">Total All Time</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.yesterdayVisitors+"</div><div class=\\"stat-label\\">Yesterday</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalSearches+"</div><div class=\\"stat-label\\">Searches</div></div>" +' +
    '"</div></div>" +' +
    '"<div class=\\"card\\"><h2>Top Searches</h2>";' +
    'if(d.topQueries&&d.topQueries.length){' +
    'for(var i=0;i<d.topQueries.length;i++){' +
    'var q=d.topQueries[i];var pct=Math.round(q.c/maxQ*100);' +
    'html+="<div style=\\"margin-bottom:10px\\"><div style=\\"display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px\\"><span>"+(q.q||"(empty)")+"</span><span style=\\"color:#8b949e\\">"+q.c+"</span></div><div style=\\"background:#21262d;border-radius:4px;height:8px\\"><div style=\\"display:inline-block;height:8px;border-radius:4px;background:#00a86b;min-width:4px;width:"+pct+"%\\"></div></div></div>"' +
    '}}else{html+="<p style=\\"color:#8b949e;font-size:13px\\">No searches yet</p>"}' +
    'html+="</div><div class=\\"card\\"><h2>Unique Visitors / Day (last 14 days)</h2>";' +
    'if(d.dailyUnique&&d.dailyUnique.length){' +
    'for(var i=0;i<d.dailyUnique.length;i++){' +
    'var day=d.dailyUnique[i];var pct=Math.round(day.c/maxU*100);' +
    'html+="<div style=\\"margin-bottom:8px\\"><div style=\\"display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px\\"><span>"+day.day+"</span><span style=\\"color:#8b949e\\">"+day.c+"</span></div><div style=\\"background:#21262d;border-radius:4px;height:8px\\"><div style=\\"display:inline-block;height:8px;border-radius:4px;background:#00a86b;min-width:4px;width:"+pct+"%\\"></div></div></div>"' +
    '}}else{html+="<p style=\\"color:#8b949e;font-size:13px\\">No activity yet</p>"}' +
    'html+="</div>";' +
    'if(d.countries&&d.countries.length){' +
    'html+="<div class=\\"card\\"><h2>Visitors by Country</h2>";' +
    'var maxC=Math.max.apply(null,d.countries.map(function(x){return x.c}));' +
    'var flags={LK:"🇱🇰",US:"🇺🇸",GB:"🇬🇧",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",AE:"🇦🇪",SA:"🇸🇦",JP:"🇯🇵",DE:"🇩🇪",FR:"🇫🇷"};' +
    'for(var i=0;i<d.countries.length;i++){' +
    'var co=d.countries[i];var pct=Math.round(co.c/maxC*100);' +
    'var flag=flags[co.country]||"";' +
    'html+="<div style=\\"margin-bottom:8px\\"><div style=\\"display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px\\"><span>"+flag+" "+co.country+"</span><span style=\\"color:#8b949e\\">"+co.c+"</span></div><div style=\\"background:#21262d;border-radius:4px;height:8px\\"><div style=\\"display:inline-block;height:8px;border-radius:4px;background:#00a86b;min-width:4px;width:"+pct+"%\\"></div></div></div>"' +
    '}html+="</div>"}' +
    'if(d.todayVisitors===0&&d.totalVisits===0){html="<div class=\\"big-stat\\" style=\\"border-color:#ff6b6b\\"><div class=\\"big-stat-value\\" style=\\"color:#ff6b6b;font-size:32px\\">No visitors yet</div><div class=\\"big-stat-label\\">Share the site to get traffic!</div></div>"}' +
    'document.getElementById("app").innerHTML=html;' +
    '}).catch(function(){document.getElementById("app").innerHTML="<p style=\\"text-align:center;padding:60px;color:#8b949e;font-size:14px\\">Error loading data</p>"})' +
    '}' +
    'function saveIp(){localStorage.setItem("myip",document.getElementById("ipInput").value);location.reload()}' +
    '</script></body></html>'
  )
})

// ─── SEO routes (imported config from seo.js) ───
const BASE_URL = 'https://grocerylk.vercel.app'
const SITE_NAME = 'GroceryLK'

// Escapes HTML special chars in dynamic store/product content to prevent broken rendering
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}
function tomorrowISO() {
  return new Date(Date.now() + 86400000).toISOString().split('T')[0]
}
function fmtPrice(p) {
  if (typeof p?.price !== 'number' || isNaN(p.price)) return 'N/A'
  return `Rs ${p.price.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`
}

async function fetchPageItems(query, limit = 10) {
  const data = await searchAllStores(query, { limit, fast: true })
  return (data.merged || []).filter(p => p.price > 0)
}

// Builds the store comparison card HTML used across all SEO pages
function storeCardsHtml(items) {
  if (!items.length) return ''
  const cheapest = [...items].sort((a, b) => a.price - b.price)[0]
  const seen = new Set()
  return items
    .filter(p => { if (seen.has(p.store)) return false; seen.add(p.store); return true })
    .map(p => {
      const isBest = cheapest && p.store === cheapest.store && p.price === cheapest.price
      const storeLink = STORE_META[p.store]?.url || p.url || '#'
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#0d1117;border-radius:10px;border:1px solid #21262d;${isBest ? 'border-color:#00a86b' : ''}">
          <div>
            <div style="font-size:13px;color:#c9d1d9;font-weight:500">${esc(p.storeName || p.store)}</div>
            <div style="font-size:11px;color:#555;margin-top:2px">${esc(p.name.length > 55 ? p.name.slice(0, 55) + '...' : p.name)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:700;color:${isBest ? '#00a86b' : '#f0f6fc'}">${fmtPrice(p)}</div>
            ${isBest ? '<div style="font-size:10px;color:#00a86b;font-weight:600;margin-top:2px">BEST PRICE</div>' : ''}
            <a href="${esc(storeLink)}" rel="noopener" style="font-size:11px;color:#8b949e;text-decoration:none">View at ${esc(p.storeName || p.store)} &#8594;</a>
          </div>
        </div>
      `
    })
    .join('')
}

function relatedLinksHtml(page) {
  if (!page.category || !CATEGORIES[page.category]) return ''
  const siblings = SEO_PAGES
    .filter(p => p.category === page.category && p.slug !== page.slug)
    .slice(0, 8)
  if (!siblings.length) return ''
  return `<div style="margin-top:28px;padding:20px;background:#161b22;border:1px solid #30363d;border-radius:12px">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;margin-bottom:12px">More ${esc(CATEGORIES[page.category].name)} prices</div>
    <div style="display:flex;flex-direction:column;gap:8px">${siblings.map(s =>
      `<a href="/p/${s.slug}" style="color:#00a86b;text-decoration:none;font-size:14px">${esc(s.name)} price &#8594;</a>`
    ).join('')}</div></div>`
}

// Fallback so SEO URLs stay 200 (never 302) even when upstream stores fail.
function sendSeoFallback(res, title, desc) {
  res.type('html').status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:40px 24px;text-align:center}
a{color:#00a86b;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<h1 style="font-size:22px;color:#f0f6fc;margin-bottom:12px">${esc(title)}</h1>
<p>We are refreshing the live store data for this page. Please check back shortly &mdash; you can still browse <a href="/">${SITE_NAME} home</a> for live comparisons.</p>
</body>
</html>`)
}

async function fetchItemsSafe(query, count) {
  try {
    return await fetchPageItems(query, count) || []
  } catch (err) {
    console.error('[SEO] store fetch failed:', query, err?.message)
    return []
  }
}

// ─── Product price SEO pages (/p/:slug) ───
app.get('/p/:slug', async (req, res) => {
  const page = SEO_PAGES.find(p => p.slug === req.params.slug)
  if (!page) return res.redirect('/')

  try {
    const items = await fetchItemsSafe(page.query, 10)
    const cheapest = items.length ? [...items].sort((a, b) => a.price - b.price)[0] : null
    const currency = 'LKR'
    const today = todayISO()
    const priceValidUntil = tomorrowISO()
    const bodyHtml = (page.body || []).map(p => `<p style="font-size:14px;color:#8b949e;line-height:1.7;margin-bottom:14px">${esc(p)}</p>`).join('')

    const jsonld = [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: `${page.name} Price in Sri Lanka`,
        description: page.desc,
        image: items.filter(p => p.image)[0]?.image || undefined,
        sku: page.slug,
        url: `${BASE_URL}/p/${page.slug}`,
        brand: { '@type': 'Brand', name: SITE_NAME },
        offers: items.map(p => ({
          '@type': 'Offer',
          price: p.price,
          priceCurrency: currency,
          priceValidUntil,
          priceSpecification: {
            '@type': 'PriceSpecification',
            price: p.price,
            priceCurrency: currency,
            valueAddedTaxIncluded: true,
          },
          seller: { '@type': 'Organization', name: p.storeName || p.store, url: STORE_META[p.store]?.url || undefined },
          url: p.url || `${BASE_URL}/p/${page.slug}`,
          availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
        })),
        aggregateRating: cheapest ? undefined : undefined,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
          ...(page.category && CATEGORIES[page.category]
            ? [{ '@type': 'ListItem', position: 2, name: CATEGORIES[page.category].name, item: `${BASE_URL}/category/${page.category}` }]
            : []),
          { '@type': 'ListItem', position: 3, name: `${page.name} Price`, item: `${BASE_URL}/p/${page.slug}` },
        ],
      },
    ]

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.desc)}">
<link rel="canonical" href="${BASE_URL}/p/${page.slug}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="dateModified" content="${today}">
<meta name="keywords" content="${esc(page.name.toLowerCase())} price sri lanka, ${esc(page.name.toLowerCase())} price, ${esc(page.query)}, grocery prices sri lanka">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.desc)}">
<meta property="og:url" content="${BASE_URL}/p/${page.slug}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.desc)}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:0}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:20px 24px;text-align:center}
.header h1{font-size:24px;color:#f0f6fc;margin-bottom:4px}
.header .sub{font-size:13px;color:#8b949e}
.header .logo-link{color:#00a86b;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;margin-top:10px}
.container{max-width:680px;margin:0 auto;padding:24px 16px}
.breadcrumb{font-size:12px;color:#555;margin-bottom:20px}
.breadcrumb a{color:#8b949e;text-decoration:none}
.breadcrumb a:hover{color:#00a86b}
.breadcrumb span{color:#555}
.results{display:flex;flex-direction:column;gap:10px}
.updated{display:inline-block;margin-bottom:16px;padding:6px 12px;background:#1b2e26;border:1px solid #00a86b;border-radius:999px;font-size:12px;color:#00a86b}
.cta{text-align:center;margin-top:32px;padding:24px;background:#161b22;border-radius:12px;border:1px solid #30363d}
.cta p{font-size:14px;color:#8b949e;margin-bottom:12px}
.cta a{display:inline-block;padding:10px 24px;background:#00a86b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}
.cta a:hover{background:#00c853}
.stores{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px}
.stores a{padding:4px 10px;background:#21262d;border-radius:4px;font-size:11px;color:#8b949e;border:1px solid #30363d;text-decoration:none}
.footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #21262d;margin-top:40px}
.footer a{color:#8b949e;text-decoration:none}
h2{font-size:16px;color:#f0f6fc;margin:24px 0 12px}
</style>
</head>
<body>
<div class="header">
  <h1>${esc(page.name === 'Rice' ? 'Rice Price in Sri Lanka Today' : `${page.name} Price in Sri Lanka`)}</h1>
  <div class="sub">Compare live prices across Kapruka, Cargills, SPAR, Glomark, Arpico &amp; GFC</div>
  <a class="logo-link" href="/">&#8592; ${SITE_NAME} Home</a>
</div>
<div class="container">
  <div class="breadcrumb"><a href="/">Home</a> <span>/</span> ${page.category && CATEGORIES[page.category] ? `<a href="/category/${page.category}">${esc(CATEGORIES[page.category].name)}</a> <span>/</span> ` : ''}<span>${esc(page.name)}</span></div>

  <span class="updated">Updated ${today} &middot; Daily live prices</span>

  ${bodyHtml}

  <h2>Live ${esc(page.name)} prices from 6 stores</h2>
  ${items.length ? `<div class="results">${storeCardsHtml(items)}</div>` : '<p style="text-align:center;padding:40px;color:#666">No prices found at the moment. Try again later.</p>'}

  ${relatedLinksHtml(page)}

  <div class="cta">
    <p>Search for any grocery item across all 6 stores</p>
    <a href="/?q=${encodeURIComponent(page.query)}">Search "${esc(page.query)}" on ${SITE_NAME} &#8594;</a>
    <div class="stores">
      ${Object.keys(STORE_META).map(s => `<a href="${esc(STORE_META[s].url)}" rel="noopener" target="_blank">${esc(STORE_META[s].name)}</a>`).join('')}
    </div>
  </div>
</div>
<div class="footer">
  <p>&copy; 2026 <a href="/">${SITE_NAME}</a> &mdash; Sri Lanka Grocery Price Comparison</p>
</div>
</body>
</html>`)
  } catch (e) {
    console.error('[SEO] /p/:slug error:', page?.slug, e?.message)
    sendSeoFallback(res, page.title, page.desc)
  }
})

// ─── Category hub pages (/category/:slug) ───
app.get('/category/:slug', async (req, res) => {
  const cat = CATEGORIES[req.params.slug]
  if (!cat) return res.redirect('/')

  const members = SEO_PAGES.filter(p => p.category === req.params.slug)
  if (!members.length) return res.redirect('/')

  try {
    const today = todayISO()
    // Aggregate one representative query per member for a combined price snapshot
    const results = await Promise.allSettled(
      members.slice(0, 6).map(m => fetchPageItems(m.query, 4).then(items => ({ page: m, items })))
    )
    const sections = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(({ items }) => items.length)

    const jsonld = [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: cat.name,
        description: cat.desc,
        url: `${BASE_URL}/category/${req.params.slug}`,
        itemListElement: sections.map(({ page, items }, i) => {
          const cheapest = [...items].sort((a, b) => a.price - b.price)[0]
          return {
            '@type': 'ListItem',
            position: i + 1,
            name: `${page.name} Price`,
            url: `${BASE_URL}/p/${page.slug}`,
            description: cheapest ? `${page.name} from ${fmtPrice(cheapest)}` : undefined,
          }
        }),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
          { '@type': 'ListItem', position: 2, name: cat.name, item: `${BASE_URL}/category/${req.params.slug}` },
        ],
      },
    ]

    const memberLinks = members.map((m, i) => {
      const sec = sections.find(s => s.page.slug === m.slug)
      const cheapest = sec?.items?.length ? [...sec.items].sort((a, b) => a.price - b.price)[0] : null
      return `<a href="/p/${m.slug}" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#0d1117;border:1px solid #21262d;border-radius:10px;text-decoration:none;margin-bottom:10px">
        <div>
          <div style="font-size:15px;color:#f0f6fc;font-weight:600">${esc(m.name)}</div>
          <div style="font-size:12px;color:#555">from ${sec?.items?.length || 0} stores</div>
        </div>
        <div style="font-size:15px;color:#00a86b;font-weight:700">${cheapest ? fmtPrice(cheapest) : ''} &#8594;</div>
      </a>`
    }).join('')

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(cat.title)}</title>
<meta name="description" content="${esc(cat.desc)}">
<link rel="canonical" href="${BASE_URL}/category/${req.params.slug}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="dateModified" content="${today}">
<meta property="og:title" content="${esc(cat.title)}">
<meta property="og:description" content="${esc(cat.desc)}">
<meta property="og:url" content="${BASE_URL}/category/${req.params.slug}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:0}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:20px 24px;text-align:center}
.header h1{font-size:24px;color:#f0f6fc;margin-bottom:4px}
.header .sub{font-size:13px;color:#8b949e}
.header .logo-link{color:#00a86b;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;margin-top:10px}
.container{max-width:680px;margin:0 auto;padding:24px 16px}
.breadcrumb{font-size:12px;color:#555;margin-bottom:20px}
.breadcrumb a{color:#8b949e;text-decoration:none}
.breadcrumb span{color:#555}
.updated{display:inline-block;margin-bottom:20px;padding:6px 12px;background:#1b2e26;border:1px solid #00a86b;border-radius:999px;font-size:12px;color:#00a86b}
.members{margin-top:20px}
.footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #21262d;margin-top:40px}
.footer a{color:#8b949e;text-decoration:none}
p{font-size:14px;color:#8b949e;line-height:1.7;margin-bottom:14px}
</style>
</head>
<body>
<div class="header">
  <h1>${esc(cat.name)} Price in Sri Lanka</h1>
  <div class="sub">Compare live prices across Kapruka, Cargills, SPAR, Glomark, Arpico &amp; GFC</div>
  <a class="logo-link" href="/">&#8592; ${SITE_NAME} Home</a>
</div>
<div class="container">
  <div class="breadcrumb"><a href="/">Home</a> <span>/</span> <span>${esc(cat.name)}</span></div>
  <span class="updated">Updated ${today} &middot; Daily live prices</span>
  <p>${esc(cat.desc)} Browse each item below to see the live price comparison across all major Sri Lankan grocery stores.</p>
  <div class="members">${memberLinks}</div>
</div>
<div class="footer">
  <p>&copy; 2026 <a href="/">${SITE_NAME}</a> &mdash; Sri Lanka Grocery Price Comparison</p>
</div>
</body>
</html>`)
  } catch (e) {
    console.error('[SEO] /category/:slug error:', req.params.slug, e?.message)
    sendSeoFallback(res, cat.title, cat.desc)
  }
})

// ─── Product x store sub-pages (/p/:slug/:store) ───
app.get('/p/:slug/:store', async (req, res) => {
  const page = SEO_PAGES.find(p => p.slug === req.params.slug)
  const storeId = req.params.store
  if (!page || !STORE_META[storeId]) return res.redirect(page ? '/p/' + page.slug : '/')
  const store = STORE_META[storeId]
  const title = `${page.name} Price at ${store.name} in Sri Lanka`
  const desc = `Compare ${page.name.toLowerCase()} prices at ${store.name} in Sri Lanka. See the current price across other stores too.`

  try {
    const items = await fetchItemsSafe(page.query, 12)
    const storeItems = items.filter(p => p.store === storeId)
    // If this store returned nothing, fall back to all items to keep the page useful
    const display = storeItems.length ? storeItems : items
    const cheapest = display.length ? [...display].sort((a, b) => a.price - b.price)[0] : null
    const today = todayISO()

    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${page.name} at ${store.name}, Sri Lanka`,
      description: desc,
      offers: display.map(p => ({
        '@type': 'Offer',
        price: p.price,
        priceCurrency: 'LKR',
        priceValidUntil: tomorrowISO(),
        seller: { '@type': 'Organization', name: p.storeName || p.store },
        url: p.url || `${BASE_URL}/p/${page.slug}/${storeId}`,
        availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      })),
    }

    const otherStores = display
      .map(p => ({ p, cheapest: p.price === cheapest?.price }))
      .map(({ p, cheapest }) =>
        `<div style="display:flex;justify-content:space-between;padding:12px 16px;background:#0d1117;border:1px solid ${cheapest ? '#00a86b' : '#21262d'};border-radius:8px;margin-bottom:8px">
          <span style="font-size:13px;color:#c9d1d9">${esc(p.storeName || p.store)}</span>
          <span style="font-size:13px;font-weight:700;color:${cheapest ? '#00a86b' : '#f0f6fc'}">${fmtPrice(p)}</span>
        </div>`).join('')

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE_URL}/p/${page.slug}/${storeId}">
<meta name="robots" content="index, follow">
<meta name="dateModified" content="${today}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:0}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:20px 24px;text-align:center}
.header h1{font-size:22px;color:#f0f6fc;margin-bottom:4px}
.header .sub{font-size:13px;color:#8b949e}
.header .logo-link{color:#00a86b;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;margin-top:10px}
.container{max-width:640px;margin:0 auto;padding:24px 16px}
.breadcrumb{font-size:12px;color:#555;margin-bottom:20px}
.breadcrumb a{color:#8b949e;text-decoration:none}
.breadcrumb span{color:#555}
.updated{display:inline-block;margin-bottom:16px;padding:6px 12px;background:#1b2e26;border:1px solid #00a86b;border-radius:999px;font-size:12px;color:#00a86b}
.footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #21262d;margin-top:40px}
.footer a{color:#8b949e;text-decoration:none}
p{font-size:14px;color:#8b949e;line-height:1.7;margin-bottom:14px}
</style>
</head>
<body>
<div class="header">
  <h1>${esc(title)}</h1>
  <div class="sub">Compare prices at ${esc(store.name)} and 5 other Sri Lankan stores</div>
  <a class="logo-link" href="/p/${page.slug}">&#8592; Back to ${esc(page.name)} prices</a>
</div>
<div class="container">
  <div class="breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/p/${page.slug}">${esc(page.name)}</a> <span>/</span> <span>${esc(store.name)}</span></div>
  <span class="updated">Updated ${today} &middot; Live price</span>
  <p>Here is the current ${esc(page.name.toLowerCase())} price at ${esc(store.name)} in Sri Lanka, compared against other stores so you can confirm you are getting the best deal.</p>
  ${otherStores}
</div>
<div class="footer">
  <p>&copy; 2026 <a href="/">${SITE_NAME}</a> &mdash; Sri Lanka Grocery Price Comparison</p>
</div>
</body>
</html>`)
  } catch (e) {
    console.error('[SEO] /p/:slug/:store error:', page?.slug, storeId, e?.message)
    sendSeoFallback(res, title, desc)
  }
})

// ─── Sinhala localized price pages (/si/:slug) ───
app.get('/si/:slug', async (req, res) => {
  const page = SEO_PAGES.find(p => p.slug === req.params.slug)
  const si = SI_PAGES[req.params.slug]
  if (!page || !si) return res.redirect('/')

  try {
    const items = await fetchItemsSafe(si.query, 10)
    const today = todayISO()
    const resultsHtml = items.length
      ? storeCardsHtml(items)
      : '<p style="text-align:center;padding:40px;color:#666">මේ මොහොතේ මිල ගණන් නොමැත. පසුව නැවත උත්සාහ කරන්න.</p>'

    res.type('html').send(`<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(si.title)}</title>
<meta name="description" content="${esc(si.desc)}">
<link rel="canonical" href="${BASE_URL}/si/${page.slug}">
<meta name="robots" content="index, follow">
<meta name="dateModified" content="${today}">
<meta hreflang="si" href="${BASE_URL}/si/${page.slug}">
<meta hreflang="en" href="${BASE_URL}/p/${page.slug}">
<meta hreflang="x-default" href="${BASE_URL}/p/${page.slug}">
<meta property="og:title" content="${esc(si.title)}">
<meta property="og:description" content="${esc(si.desc)}">
<meta property="og:url" content="${BASE_URL}/si/${page.slug}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:0}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:20px 24px;text-align:center}
.header h1{font-size:24px;color:#f0f6fc;margin-bottom:4px}
.header .sub{font-size:13px;color:#8b949e}
.header .logo-link{color:#00a86b;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;margin-top:10px}
.container{max-width:680px;margin:0 auto;padding:24px 16px}
.breadcrumb{font-size:12px;color:#555;margin-bottom:20px}
.breadcrumb a{color:#8b949e;text-decoration:none}
.breadcrumb span{color:#555}
.results{display:flex;flex-direction:column;gap:10px}
.updated{display:inline-block;margin-bottom:16px;padding:6px 12px;background:#1b2e26;border:1px solid #00a86b;border-radius:999px;font-size:12px;color:#00a86b}
.footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #21262d;margin-top:40px}
.footer a{color:#8b949e;text-decoration:none}
</style>
</head>
<body>
<div class="header">
  <h1>${esc(si.name)} — ශ්‍රී ලංකාව</h1>
  <div class="sub">Kapruka, Cargills, SPAR, Glomark, Arpico &amp; GFC හරහා මිල සසඳන්න</div>
  <a class="logo-link" href="/">&#8592; ${SITE_NAME} මුල් පිටුව</a>
</div>
<div class="container">
  <div class="breadcrumb"><a href="/">මුල් පිටුව</a> <span>/</span> <a href="/p/${page.slug}">English</a> <span>/</span> <span>${esc(si.name)}</span></div>
  <span class="updated">යාවත්කාලීන ${today}</span>
  <p style="font-size:14px;color:#8b949e;line-height:1.7;margin-bottom:20px">${esc(si.desc)} මිල ගණන් සියලුම ප්‍රධාන සුපිරි වෙළඳසැල්වලින් දිනපතා යාවත්කාලීන වේ.</p>
  <div class="results">${resultsHtml}</div>
</div>
<div class="footer">
  <p>&copy; 2026 <a href="/">${SITE_NAME}</a></p>
</div>
</body>
</html>`)
  } catch (e) {
    console.error('[SEO] /si/:slug error:', req.params.slug, e?.message)
    sendSeoFallback(res, si.title, si.desc)
  }
})

// ─── Dynamic sitemap with lastmod ───
app.get('/sitemap.xml', (req, res) => {
  const today = todayISO()
  const url = (loc, priority, freq = 'daily') => `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`

  const home = url(`${BASE_URL}/`, '1.0', 'daily')
  // Category hubs
  const cats = Object.keys(CATEGORIES).map(c => url(`${BASE_URL}/category/${c}`, '0.9', 'daily')).join('\n')
  // Product pages
  const products = SEO_PAGES.map(p => url(`${BASE_URL}/p/${p.slug}`, '0.8', 'hourly')).join('\n')
  // Store sub-pages
  const subpages = []
  for (const [slug, stores] of Object.entries(STORE_SUBPAGES)) {
    if (!SEO_PAGES.find(p => p.slug === slug)) continue
    for (const store of stores) {
      if (STORE_META[store]) subpages.push(url(`${BASE_URL}/p/${slug}/${store}`, '0.7', 'hourly'))
    }
  }
  // Sinhala pages
  const siPages = Object.keys(SI_PAGES).map(s => SEO_PAGES.find(p => p.slug === s) ? url(`${BASE_URL}/si/${s}`, '0.7', 'daily') : '').filter(Boolean).join('\n')

  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${home}
${cats}
${products}
${subpages.join('\n')}
${siPages}
</urlset>`)
})

// ─── robots.txt ───
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin

Sitemap: ${BASE_URL}/sitemap.xml
`)
})

// ─── IndexNow (real-time indexing signal) ───
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '2f7c9e3a8b1d4f6a9c0e5b7d3a1f8c4e'
app.get('/indexnow-key-9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d.txt', (req, res) => {
  res.type('text/plain').send(INDEXNOW_KEY)
})
app.post('/api/indexnow', async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : []
    if (!urls.length) return res.status(400).json({ error: 'urls required' })
    const clean = urls.map(u => u.replace(/^https?:\/\//, '')).map(u => u.replace(/^www\./, ''))
    await fetch(`https://api.indexnow.org/indexnow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'grocerylk.vercel.app',
        key: INDEXNOW_KEY,
        keyLocation: `${BASE_URL}/indexnow-key-9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d.txt`,
        urlList: clean.map(u => `${BASE_URL}/${u}`),
      }),
    })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/short', (req, res) => {
  try {
    const html = readFileSync(path.join(__dirname, 'youtube-short.html'), 'utf-8')
    res.type('html').send(html)
  } catch (e) {
    res.redirect('/')
  }
});

// ─── Promo video ───
app.get('/promo.mp4', (req, res) => {
  res.sendFile(path.join(__dirname, 'promo.mp4'));
});

// ─── Production: serve client build ───
const clientDist = path.join(__dirname, 'dist');
app.use(express.static(clientDist));

// The SPA is a single page at "/" — serve index.html only there. All other unknown
// paths return a real 404 to avoid soft-404 dilution of crawl budget.
const SPA_RESERVED = new Set(['/', '/index.html', '/privacy', '/terms', '/about'])
app.get('*', (req, res) => {
  const clean = req.path.split('?')[0]
  if (SPA_RESERVED.has(clean)) {
    return res.sendFile(path.join(clientDist, 'index.html'))
  }
  res.status(404).send('<h1>404 - Page not found</h1>')
})

export default app;

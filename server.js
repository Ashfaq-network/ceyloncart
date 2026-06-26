import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getDb, initDb, getCachedSearch, setCachedSearch, getCacheStats, recordEvent, getAnalyticsSummary, getCachedCategory, setCachedCategory } from './db.js';
import { cleanName, formatPrice } from './utils.js';
import { searchGlomark, normalizeGlomark } from './glomark-connector.js';
import { searchArpico } from './arpico-connector.js';

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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

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
  'string', 'hopper', 'hopper', 'bread', 'chilli', 'turmeric', 'cumin', 'pepper',
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

async function fetchKaprukaImage(productId, productUrl) {
  if (kaprukaImageCache.has(productId)) return kaprukaImageCache.get(productId);
  try {
    const res = await fetch(productUrl, { signal: AbortSignal.timeout(5000) });
    const html = await res.text();
    const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const url = match ? match[1] : '';
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
    return healthy.filter(s => STORE_PRIORITY.indexOf(s) <= STORE_PRIORITY.indexOf('glomark'))
  }
  return healthy
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
    '.stat{text-align:center;padding:16px;background:#0d1117;border:1px solid #30363d;border-radius:6px}' +
    '.stat-value{font-size:28px;font-weight:700;color:#f0f6fc}' +
    '.stat-label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}' +
    '</style></head><body>' +
    '<h1>GroceryLK</h1><p class="sub">Analytics Dashboard</p>' +
    '<div id="app"><p style="text-align:center;padding:60px;color:#8b949e;font-size:14px">Loading...</p></div>' +
    '<script>' +
    'var myIp=localStorage.getItem("myip")||"";' +
    'function fetchData(){' +
    'var url="/api/analytics/dashboard";' +
    'if(myIp)url+="?exclude_ip="+encodeURIComponent(myIp);' +
    'fetch(url).then(function(r){return r.json()}).then(function(d){' +
    'var maxQ=d.topQueries&&d.topQueries.length?Math.max.apply(null,d.topQueries.map(function(x){return x.c})):1;' +
    'var maxU=d.dailyUnique&&d.dailyUnique.length?Math.max.apply(null,d.dailyUnique.map(function(x){return x.c})):1;' +
    'var html=' +
    '"<div style=\\"margin-bottom:20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap\\"><span style=\\"font-size:12px;color:#8b949e\\">Your IP:</span><input id=\\"ipInput\\" value=\\""+myIp+"\\" style=\\"padding:6px 10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:13px;width:160px\\" placeholder=\\"Enter your IP\\"/><button onclick=\\"saveIp()\\" style=\\"padding:6px 14px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:12px;cursor:pointer\\">Exclude me</button><span style=\\"font-size:11px;color:#555\\">(reloads chart)</span></div>" +' +
    '"<div class=\\"card\\"><div class=\\"stats\\">" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalVisits+"</div><div class=\\"stat-label\\">Total Visitors</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.yesterdayVisitors+"</div><div class=\\"stat-label\\">Yesterday Visitors</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalSearches+"</div><div class=\\"stat-label\\">Searches</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalListsCreated+"</div><div class=\\"stat-label\\">Lists Created</div></div>" +' +
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
    'for(var i=0;i<d.countries.length;i++){' +
    'var co=d.countries[i];var pct=Math.round(co.c/maxC*100);' +
    'html+="<div style=\\"margin-bottom:8px\\"><div style=\\"display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px\\"><span>"+co.country+"</span><span style=\\"color:#8b949e\\">"+co.c+"</span></div><div style=\\"background:#21262d;border-radius:4px;height:8px\\"><div style=\\"display:inline-block;height:8px;border-radius:4px;background:#00a86b;min-width:4px;width:"+pct+"%\\"></div></div></div>"' +
    '}html+="</div>"}' +
    'document.getElementById("app").innerHTML=html;' +
    '}).catch(function(){document.getElementById("app").innerHTML="<p style=\\"text-align:center;padding:60px;color:#8b949e;font-size:14px\\">Error loading data</p>"})' +
    '}' +
    'function saveIp(){localStorage.setItem("myip",document.getElementById("ipInput").value);location.reload()}' +
    'fetchData();' +
    '</script></body></html>'
  )
})

// ─── SEO product pages ───
const SEO_PAGES = [
  { slug: 'rice-price-sri-lanka', query: 'rice', name: 'Rice', desc: 'Compare rice prices across Sri Lankan stores. Find the best deal on nike rice, basmati, samba, and more.' },
  { slug: 'dhal-price-sri-lanka', query: 'dhal', name: 'Dhal', desc: 'Compare dhal (parippu) prices in Sri Lanka. Find the cheapest red dhal, green gram, and lentils across stores.' },
  { slug: 'milk-powder-price-sri-lanka', query: 'milk powder', name: 'Milk Powder', desc: 'Compare milk powder prices in Sri Lanka. Find the best deal on Anchor, Ratthi, Nespray, and more brands.' },
  { slug: 'eggs-price-sri-lanka', query: 'eggs', name: 'Eggs', desc: 'Compare egg prices across Sri Lankan stores. Find the cheapest tray of eggs near you.' },
  { slug: 'sugar-price-sri-lanka', query: 'sugar', name: 'Sugar', desc: 'Compare sugar prices in Sri Lanka. Find the best deal on white sugar, brown sugar, and more.' },
  { slug: 'bread-price-sri-lanka', query: 'bread', name: 'Bread', desc: 'Compare bread prices across Sri Lankan stores. Find sandwich bread, whole wheat, and more.' },
  { slug: 'chicken-price-sri-lanka', query: 'chicken', name: 'Chicken', desc: 'Compare chicken prices in Sri Lanka. Find the best deal on fresh chicken, whole chicken, and cuts.' },
  { slug: 'soap-price-sri-lanka', query: 'soap', name: 'Soap', desc: 'Compare soap and bath product prices in Sri Lanka. Find Lux, Lifebuoy, Dettol, and more.' },
  { slug: 'biscuits-price-sri-lanka', query: 'biscuits', name: 'Biscuits', desc: 'Compare biscuit prices across Sri Lankan stores. Find Maliban, Munchee, and more brands.' },
  { slug: 'tea-price-sri-lanka', query: 'tea', name: 'Tea', desc: 'Compare tea prices in Sri Lanka. Find Dilmah, Lipton, Zesta, and Ceylon tea at the best price.' },
  { slug: 'cooking-oil-price-sri-lanka', query: 'cooking oil', name: 'Cooking Oil', desc: 'Compare cooking oil prices in Sri Lanka. Find coconut oil, vegetable oil, and olive oil at the best price.' },
  { slug: 'noodles-price-sri-lanka', query: 'noodles', name: 'Noodles', desc: 'Compare noodle prices in Sri Lanka. Find Maggi, Prima, Koka, and instant noodles across stores.' },
  { slug: 'yogurt-price-sri-lanka', query: 'yogurt', name: 'Yogurt', desc: 'Compare yogurt and curd prices in Sri Lanka. Find the best deal on set yogurts, drinking yogurt, and more.' },
  { slug: 'fish-price-sri-lanka', query: 'fish', name: 'Fish', desc: 'Compare fish and seafood prices in Sri Lanka. Find fresh fish, canned fish, and frozen seafood across stores.' },
  { slug: 'battery-price-sri-lanka', query: 'battery', name: 'Batteries', desc: 'Compare battery prices in Sri Lanka. Find AA, AAA, and rechargeable batteries from Eveready, Duracell, and more.' },
  { slug: 'shampoo-price-sri-lanka', query: 'shampoo', name: 'Shampoo', desc: 'Compare shampoo prices in Sri Lanka. Find Sunsilk, Pantene, Dove, and Head & Shoulders at the best price.' },
  { slug: 'toothpaste-price-sri-lanka', query: 'toothpaste', name: 'Toothpaste', desc: 'Compare toothpaste prices in Sri Lanka. Find Colgate, Pepsodent, Sensodyne, and more across stores.' },
  { slug: 'masala-price-sri-lanka', query: 'masala', name: 'Masala & Spices', desc: 'Compare masala and spice prices in Sri Lanka. Find curry powder, chili powder, turmeric, and更多 spices.' },
  { slug: 'jam-price-sri-lanka', query: 'jam', name: 'Jam', desc: 'Compare jam prices in Sri Lanka. Find fruit jam, marmalade, and spreads at the cheapest price.' },
  { slug: 'sauce-price-sri-lanka', query: 'sauce', name: 'Sauce', desc: 'Compare sauce prices across Sri Lankan stores. Find ketchup, chili sauce, soya sauce, and更多.' },
  { slug: 'ice-cream-price-sri-lanka', query: 'ice cream', name: 'Ice Cream', desc: 'Compare ice cream prices in Sri Lanka. Find ice cream tubs, cones, and popsicles across stores.' },
  { slug: 'toilet-paper-price-sri-lanka', query: 'toilet paper', name: 'Toilet Paper', desc: 'Compare toilet paper and tissue prices in Sri Lanka. Find rolls, packs, and jumbo rolls at the best price.' },
  { slug: 'detergent-price-sri-lanka', query: 'detergent', name: 'Detergent', desc: 'Compare laundry detergent prices in Sri Lanka. Find Ariel, Surf Excel, and washing powder across stores.' },
  { slug: 'water-price-sri-lanka', query: 'water bottles', name: 'Water Bottles', desc: 'Compare bottled water prices in Sri Lanka. Find 1L and 1.5L bottles across stores.' },
  { slug: 'baby-diapers-price-sri-lanka', query: 'diapers', name: 'Baby Diapers', desc: 'Compare diaper prices in Sri Lanka. Find Pampers, Huggies, and baby wipes at the best price.' },
  { slug: 'cereal-price-sri-lanka', query: 'cereal', name: 'Breakfast Cereal', desc: 'Compare breakfast cereal prices in Sri Lanka. Find Corn Flakes, oats, granola, and muesli across stores.' },
  { slug: 'ketchup-price-sri-lanka', query: 'ketchup', name: 'Ketchup', desc: 'Compare ketchup and tomato sauce prices in Sri Lanka. Find Maggi, Del Monte, and Heinz across stores.' },
  { slug: 'cheese-price-sri-lanka', query: 'cheese', name: 'Cheese', desc: 'Compare cheese prices in Sri Lanka. Find cheddar, processed cheese, mozzarella, and cheese slices.' },
  { slug: 'sambol-price-sri-lanka', query: 'sambol', name: 'Sambol', desc: 'Compare sambol and seeni sambol prices in Sri Lanka. Find coconut sambol, Maldives fish sambol, and chili paste.' },
  { slug: 'soya-meat-price-sri-lanka', query: 'soya meat', name: 'Soya Meat', desc: 'Compare soya meat and TVP prices in Sri Lanka. Find soya chunks, mince, and nuggets across stores.' },
  { slug: 'toothbrush-price-sri-lanka', query: 'toothbrush', name: 'Toothbrush', desc: 'Compare toothbrush prices in Sri Lanka. Find Oral-B, Colgate, and electric toothbrushes across stores.' },
  { slug: 'dilmah-tea-price-sri-lanka', query: 'dilmah', name: 'Dilmah Tea', desc: 'Compare Dilmah tea prices in Sri Lanka. Find Dilmah Ceylon tea bags, green tea, and premium tea boxes.' },
  { slug: 'kiribath-price-sri-lanka', query: 'kiribath', name: 'Kiribath Ingredients', desc: 'Compare kiribath and milk rice ingredient prices in Sri Lanka. Find rice, coconut milk, and更多.' },
  { slug: 'coconut-price-sri-lanka', query: 'coconut', name: 'Coconut', desc: 'Compare coconut and coconut product prices in Sri Lanka. Find fresh coconuts, coconut milk, and coconut oil.' },
  { slug: 'salt-price-sri-lanka', query: 'salt', name: 'Salt', desc: 'Compare salt prices in Sri Lanka. Find table salt, sea salt, and rock salt across stores.' },
  { slug: 'face-cream-price-sri-lanka', query: 'face cream', name: 'Face Cream', desc: 'Compare face cream and moisturizer prices in Sri Lanka. Find Nivea, Olay, Ponds, and更多 brands.' },
  { slug: 'washing-powder-price-sri-lanka', query: 'washing powder', name: 'Washing Powder', desc: 'Compare washing powder prices in Sri Lanka. Find laundry detergent, stain remover, and fabric softener.' },
  { slug: 'candle-price-sri-lanka', query: 'candle', name: 'Candles', desc: 'Compare candle prices in Sri Lanka. Find scented candles, tea lights, and emergency candles across stores.' },
  { slug: 'tuna-price-sri-lanka', query: 'tuna', name: 'Tuna', desc: 'Compare canned tuna prices in Sri Lanka. Find tuna in oil, brine, and flavored tuna across stores.' },
  { slug: 'fruit-juice-price-sri-lanka', query: 'fruit juice', name: 'Fruit Juice', desc: 'Compare fruit juice prices in Sri Lanka. Find orange juice, mango juice, and mixed fruit juice cartons.' },
]

app.get('/p/:slug', async (req, res) => {
  const page = SEO_PAGES.find(p => p.slug === req.params.slug)
  if (!page) return res.redirect('/')

  try {
    const data = await searchAllStores(page.query, { limit: 10, fast: true })
    const items = data.merged || []
    const cheapest = items.filter(p => p.price).sort((a, b) => a.price - b.price)[0]
    const currency = 'LKR'

    let resultsHtml = ''
    if (items.length === 0) {
      resultsHtml = '<p style="text-align:center;padding:40px;color:#666">No prices found at the moment. Try again later.</p>'
    } else {
      const seen = new Set()
      resultsHtml = items.filter(p => { if (seen.has(p.store)) return false; seen.add(p.store); return true }).map(p => {
        const isBest = cheapest && p.store === cheapest.store && p.price === cheapest.price
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#0d1117;border-radius:10px;border:1px solid #21262d;${isBest ? 'border-color:#00a86b' : ''}">
            <div>
              <div style="font-size:13px;color:#c9d1d9;font-weight:500">${p.storeName || p.store}</div>
              <div style="font-size:11px;color:#555;margin-top:2px">${p.name.length > 50 ? p.name.slice(0, 50) + '...' : p.name}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:700;color:${isBest ? '#00a86b' : '#f0f6fc'}">${p.priceFormatted || `Rs ${p.price?.toLocaleString() || 'N/A'}`}</div>
              ${isBest ? '<div style="font-size:10px;color:#00a86b;font-weight:600;margin-top:2px">BEST PRICE</div>' : ''}
            </div>
          </div>
        `
      }).join('')
    }

    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${page.name} Price Comparison - Sri Lanka`,
      description: page.desc,
      offers: items.filter(p => p.price).map(p => ({
        '@type': 'Offer',
        price: p.price,
        priceCurrency: currency,
        seller: { '@type': 'Organization', name: p.storeName || p.store },
        url: p.url || 'https://grocerylk.vercel.app/',
        availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      })),
    }

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${page.name} Price in Sri Lanka 2026 | Compare Across Stores | GroceryLK</title>
<meta name="description" content="${page.desc} Check prices at Kapruka, Cargills, SPAR, Glomark, Arpico &amp; GFC.">
<link rel="canonical" href="https://grocerylk.vercel.app/p/${page.slug}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${page.name} Price in Sri Lanka | GroceryLK">
<meta property="og:description" content="${page.desc}">
<meta property="og:url" content="https://grocerylk.vercel.app/p/${page.slug}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GroceryLK">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${page.name} Price in Sri Lanka | GroceryLK">
<meta name="twitter:description" content="${page.desc}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:0}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:20px 24px;text-align:center}
.header h1{font-size:22px;color:#f0f6fc;margin-bottom:4px}
.header .sub{font-size:13px;color:#8b949e}
.header .logo-link{color:#00a86b;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;margin-top:10px}
.container{max-width:600px;margin:0 auto;padding:24px 16px}
.breadcrumb{font-size:12px;color:#555;margin-bottom:20px}
.breadcrumb a{color:#8b949e;text-decoration:none}
.breadcrumb a:hover{color:#00a86b}
.breadcrumb span{color:#555}
.results{display:flex;flex-direction:column;gap:10px}
.cta{text-align:center;margin-top:32px;padding:24px;background:#161b22;border-radius:12px;border:1px solid #30363d}
.cta p{font-size:14px;color:#8b949e;margin-bottom:12px}
.cta a{display:inline-block;padding:10px 24px;background:#00a86b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}
.cta a:hover{background:#00c853}
.stores{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px}
.stores span{padding:4px 10px;background:#21262d;border-radius:4px;font-size:11px;color:#8b949e;border:1px solid #30363d}
.footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #21262d;margin-top:40px}
.footer a{color:#8b949e;text-decoration:none}
</style>
</head>
<body>
<div class="header">
  <h1>${page.name} Price in Sri Lanka</h1>
  <div class="sub">Compare prices across Kapruka, Cargills, SPAR, Glomark, Arpico &amp; GFC</div>
  <a class="logo-link" href="/">&#8592; GroceryLK Home</a>
</div>
<div class="container">
  <div class="breadcrumb"><a href="/">Home</a> <span>/</span> <span>${page.name}</span></div>

  <p style="font-size:14px;color:#8b949e;margin-bottom:20px;line-height:1.6">${page.desc} Prices updated in real-time from all major Sri Lankan grocery stores.</p>

  <div class="results">${resultsHtml}</div>

  <div class="cta">
    <p>Search for any grocery item across all 6 stores</p>
    <a href="/?q=${encodeURIComponent(page.query)}">Search "${page.query}" on GroceryLK &#8594;</a>
    <div class="stores">
      <span>Kapruka</span><span>Cargills</span><span>SPAR</span><span>Glomark</span><span>Arpico</span><span>GFC</span>
    </div>
  </div>
</div>
<div class="footer">
  <p>&copy; 2026 <a href="/">GroceryLK</a> &mdash; Sri Lanka Grocery Price Comparison</p>
</div>
</body>
</html>`)
  } catch (e) {
    res.redirect('/')
  }
})
app.get('/sitemap.xml', (req, res) => {
  const urls = SEO_PAGES.map(p => `  <url><loc>https://grocerylk.vercel.app/p/${p.slug}</loc><priority>0.8</priority></url>`).join('\n')
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://grocerylk.vercel.app/</loc><priority>1.0</priority></url>
${urls}
</urlset>`)
})
import { readFileSync } from 'fs';
const __shortHtml = readFileSync(path.join(__dirname, 'youtube-short.html'), 'utf-8');
app.get('/short', (req, res) => res.type('html').send(__shortHtml));

// ─── Production: serve client build ───
const clientDist = path.join(__dirname, 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;

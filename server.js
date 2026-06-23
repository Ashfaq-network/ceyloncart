import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getDb, getCachedSearch, setCachedSearch, getCacheStats, recordEvent, getAnalyticsSummary } from './db.js';
import { cleanName, formatPrice } from './utils.js';
import { searchGlomark, normalizeGlomark } from './glomark-connector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// ─── Store registry ───
const STORES = {
  kapruka: { name: 'Kapruka', icon: '🛒', orderable: true, deliveryFee: 250, freeDeliveryMin: 5000 },
  gfc: { name: 'Global Food City', icon: '🏪', orderable: false, deliveryFee: 350, freeDeliveryMin: 3000 },
  spar: { name: 'SPAR', icon: '🛍️', orderable: false, deliveryFee: 300, freeDeliveryMin: 3000 },
  glomark: { name: 'Glomark', icon: '🛒', orderable: false, deliveryFee: 0, freeDeliveryMin: 0 },
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
  'orient', 'savemor', 'banno', 'catch', 'alli',
]);

const PRODUCT_TYPES = new Set([
  'flour', 'oil', 'sugar', 'dhal', 'spice', 'spices', 'tea',
  'milk', 'powder', 'soap', 'shampoo', 'detergent', 'lotion', 'cream', 'paste',
  'salt', 'noodles', 'pasta', 'biscuit', 'chocolate', 'drink', 'juice', 'water',
  'tuna', 'fish', 'chicken', 'meat', 'egg', 'butter', 'cheese', 'yogurt',
  'toothpaste', 'brush', 'tissue', 'paper', 'cleaner', 'cooking',
  'string', 'hopper', 'hopper', 'bread', 'chilli', 'turmeric', 'cumin', 'pepper',
  'onion', 'potato', 'tomato', 'carrot', 'lemon', 'coconut', 'banana',
  'noodles', 'vermicelli', 'flakes', 'mixture',
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
  if (unit === 'kilo') { val *= 1000; unit = 'g'; }
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

      if (score >= 0.55) {
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

// ─── Search all stores helper (no self-fetching) ───
async function searchAllStores(query, opts = {}) {
  const { limit = 30, sort = '', cursor = null, category = null, stores = null } = opts
  const activeStores = stores || Object.keys(STORES)
  const searches = []

  if (activeStores.includes('kapruka')) {
    searches.push(
      kaprukaCall('kapruka_search_products', {
        q: query, category: category || null, limit,
        sort: sort || 'relevance', cursor: cursor || null,
      }).then(normalizeKapruka).catch(e => ({ results: [], total: 0, _error: e.message }))
    )
  }

  if (activeStores.includes('gfc')) {
    searches.push(
      searchGFC(query, { limit, cursor })
        .then(({ raw }) => normalizeGFC(raw))
        .catch(e => ({ results: [], total: 0, _error: e.message }))
    )
  }

  if (activeStores.includes('spar')) {
    searches.push(
      searchSPAR(query, { limit })
        .then(normalizeSPAR)
        .catch(e => ({ results: [], total: 0, _error: e.message }))
    )
  }

  if (activeStores.includes('glomark')) {
    searches.push(
      searchGlomark(query, { limit })
        .then(({ products }) => normalizeGlomark(products, STORES.glomark.name))
        .catch(e => ({ results: [], total: 0, _error: e.message }))
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
  res.json(await getCacheStats());
});

function normalizeQuery(query) {
  return query.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const HOMEPAGE_SECTIONS = {
  featured: ['rice', 'dhal', 'coconut', 'milk', 'eggs', 'tea', 'bread', 'sugar'],
  new: ['snacks', 'noodles', 'chocolate', 'drinks', 'biscuits', 'oil', 'soap', 'shampoo'],
  bestsellers: ['dilmah', 'nestle', 'unilever', 'maggi', 'prima', 'elephant house'],
  suggested: ['fruits', 'vegetables', 'chicken', 'fish', 'yogurt', 'cheese', 'butter', 'juice'],
};

app.get('/api/homepage', async (req, res) => {
  try {
    const result = {};
    const globalSeen = new Set();
    const MAX_PER_SECTION = 20;

    const sectionPromises = Object.entries(HOMEPAGE_SECTIONS).map(async ([section, queries]) => {
      const sectionProducts = [];
      const queryPromises = queries.map(q =>
        searchAllStores(q, { limit: 8 })
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
    res.json({ sections: result });
  } catch (e) {
    res.json({ sections: {}, error: e.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q, category, limit, sort, cursor, stores: storeFilter, skipCache } = req.query;
    const query = (q || '').trim();
    if (!query) return res.json({ results: [], matched: [], total: 0, query: '', stores: Object.keys(STORES) });

    const maxResults = parseInt(limit) || 30;
    const activeStores = storeFilter ? storeFilter.split(',') : Object.keys(STORES);

    const normalizedQuery = normalizeQuery(query);
    const sortParam = sort || '';

    if (!skipCache) {
      const cached = await getCachedSearch(normalizedQuery, activeStores, sortParam);
      if (cached) return res.json(cached);
    }

    const { merged, matched, total } = await searchAllStores(query, {
      limit: maxResults, sort, cursor, category, stores: activeStores,
    });

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
      depth: parseInt(req.query.depth) || 1,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cities', async (req, res) => {
  try {
    const data = await kaprukaCall('kapruka_list_delivery_cities', {
      query: req.query.query || null, limit: parseInt(req.query.limit) || 25,
    });
    res.json(data);
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
  const { type, session_id, data } = req.body || {}
  if (!type) return res.status(400).json({ error: 'type required' })
  await recordEvent(type, session_id, data, req.ip, req.headers['user-agent'])
  res.json({ ok: true })
})

app.get('/api/analytics/dashboard', async (req, res) => {
  res.json(await getAnalyticsSummary())
})

// ─── Admin dashboard page ───
app.get('/admin', (req, res) => {
  res.type('html').send(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>CeylonCart Analytics</title>' +
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
    '<h1>CeylonCart</h1><p class="sub">Analytics Dashboard</p>' +
    '<div id="app"><p style="text-align:center;padding:60px;color:#8b949e;font-size:14px">Loading...</p></div>' +
    '<script>' +
    'async function load(){' +
    'var r=await fetch("/api/analytics/dashboard");' +
    'var d=await r.json();' +
    'var maxQ=d.topQueries&&d.topQueries.length?Math.max.apply(null,d.topQueries.map(function(x){return x.c})):1;' +
    'var maxD=d.dailyEvents&&d.dailyEvents.length?Math.max.apply(null,d.dailyEvents.map(function(x){return x.c})):1;' +
    'var html=' +
    '"<div class=\\"card\\"><div class=\\"stats\\">" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalVisits+"</div><div class=\\"stat-label\\">Visits</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalSearches+"</div><div class=\\"stat-label\\">Searches</div></div>" +' +
    '"<div class=\\"stat\\"><div class=\\"stat-value\\">"+d.totalListsCreated+"</div><div class=\\"stat-label\\">Lists Created</div></div>" +' +
    '"</div></div>" +' +
    '"<div class=\\"card\\"><h2>Top Searches</h2>";' +
    'if(d.topQueries&&d.topQueries.length){' +
    'for(var i=0;i<d.topQueries.length;i++){' +
    'var q=d.topQueries[i];var pct=Math.round(q.c/maxQ*100);' +
    'html+="<div style=\\"margin-bottom:10px\\"><div style=\\"display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px\\"><span>"+(q.q||"(empty)")+"</span><span style=\\"color:#8b949e\\">"+q.c+"</span></div><div style=\\"background:#21262d;border-radius:4px;height:8px\\"><div style=\\"display:inline-block;height:8px;border-radius:4px;background:#00a86b;min-width:4px;width:"+pct+"%\\"></div></div></div>"' +
    '}}else{html+="<p style=\\"color:#8b949e;font-size:13px\\">No searches yet</p>"}' +
    'html+="</div><div class=\\"card\\"><h2>Daily Activity (last 14 days)</h2>";' +
    'if(d.dailyEvents&&d.dailyEvents.length){' +
    'for(var i=0;i<d.dailyEvents.length;i++){' +
    'var day=d.dailyEvents[i];var pct=Math.round(day.c/maxD*100);' +
    'html+="<div style=\\"margin-bottom:8px\\"><div style=\\"display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px\\"><span>"+day.day+"</span><span style=\\"color:#8b949e\\">"+day.c+"</span></div><div style=\\"background:#21262d;border-radius:4px;height:8px\\"><div style=\\"display:inline-block;height:8px;border-radius:4px;background:#00a86b;min-width:4px;width:"+pct+"%\\"></div></div></div>"' +
    '}}else{html+="<p style=\\"color:#8b949e;font-size:13px\\">No activity yet</p>"}' +
    'html+="</div>";' +
    'document.getElementById("app").innerHTML=html;' +
    '}' +
    'load();' +
    '</script></body></html>'
  )
})

// ─── Production: serve client build ───
const clientDist = path.join(__dirname, 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;

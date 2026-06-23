import { cleanName, formatPrice } from './utils.js';

const GLOMARK_BASE = 'https://glomark.lk';

export async function searchGlomark(query, opts = {}) {
  const url = `${GLOMARK_BASE}/search?search-text=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Glomark HTTP error: ${res.status}`);
  const html = await res.text();

  const parts = html.split('product-box justify-content-center');
  if (parts.length < 2) return { products: [], total: 0 };

  const products = [];
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const nameMatch = block.match(/<span class="light-font">\s*([^<]+?)\s*<\/span>/i);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    const priceMatch = block.match(/<strong class="clr-txt">Rs\s*([\d,]+\.?\d*)<\/strong>/i);
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!price) continue;

    const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const image = imgMatch ? imgMatch[1] : '';

    const urlMatch = block.match(/<a href="(\/[^"]+)"[\s>]/i);
    const productUrl = urlMatch ? `${GLOMARK_BASE}${urlMatch[1].split('?')[0]}` : '';

    const idMatch = block.match(/data-prod-id="(\d+)"/);
    const originalId = idMatch ? idMatch[1] : (urlMatch?.[1]?.match(/\/p\/(\d+)/)?.[1] || '');

    const salePriceMatch = block.match(/<strike class="promo-price">Rs\s*([\d,]+\.?\d*)<\/strike>/i);
    const originalPrice = salePriceMatch ? parseFloat(salePriceMatch[1].replace(/,/g, '')) : price;

    const qtyMatch = block.match(/<div class="product-Quanitity">([^<]*)<\/div>/i);
    const qty = qtyMatch ? qtyMatch[1].replace(/&nbsp;/g, ' ').trim() : '';

    const outOfStock = /\bout\s*O?f?\s*[Ss]tock\b/.test(block);

    products.push({
      name,
      price,
      originalPrice,
      image,
      url: productUrl,
      id: originalId,
      qty,
      inStock: !outOfStock,
    });
  }

  return { products, total: products.length };
}

export function normalizeGlomark(products, storeName) {
  const results = products.map(p => ({
    id: `glomark:${p.id}`,
    originalId: p.id,
    name: cleanName(p.name),
    store: 'glomark',
    storeName,
    price: p.price,
    priceFormatted: formatPrice(p.price),
    currency: 'LKR',
    image: p.image,
    url: p.url,
    inStock: p.inStock !== false,
    category: '',
    sku: '',
  }));
  return { results, total: results.length };
}

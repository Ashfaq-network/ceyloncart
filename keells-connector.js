import { chromium } from 'playwright';

const KEELLS_URL = 'https://keellssuper.com';

export class KeellsConnector {
  constructor() {
    this.browser = null;
    this.page = null;
    this.ready = false;
  }

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: `/tmp/cargills-libs/extracted/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ''}`,
      },
    });
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    this.page = await context.newPage();

    // Initial load - establishes Cloudflare cookies and guest session
    await this.page.goto(KEELLS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    for (let i = 0; i < 30; i++) {
      const ready = await this.page.evaluate(() =>
        document.querySelector('input[placeholder="Search on Keells Online"]') !== null
      ).catch(() => false);
      if (ready) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 3000));
    this.ready = true;
  }

  async search(query, { itemsPerPage = 20 } = {}) {
    if (!this.ready) await this.init();

    // Navigate directly to the search results page
    // This triggers the React app to load product data via the API
    const searchUrl = `${KEELLS_URL}/product?cat=4&s=~${encodeURIComponent(query)}`;

    // Set up response interceptor BEFORE navigation
    let resolveResponse;
    const responsePromise = new Promise(resolve => { resolveResponse = resolve; });
    const handler = async (res) => {
      const url = res.url();
      // Only capture the search-specific GetItemDetails call (with itemDescription)
      if (url.includes('GetItemDetails') && url.includes('itemDescription=')) {
        try {
          const text = await res.text();
          resolveResponse(JSON.parse(text));
        } catch {
          resolveResponse(null);
        }
      }
    };
    this.page.on('response', handler);
    const timeoutId = setTimeout(() => resolveResponse(null), 20000);

    try {
      const navPromise = this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(() => {});
      await Promise.race([navPromise, new Promise(r => setTimeout(r, 15000))]);
      const data = await responsePromise;
      if (data && data.result?.itemDetailResult?.itemDetails) {
        const items = data.result.itemDetailResult.itemDetails;
        const mapped = items.map(item => ({
          id: `keells-${item.itemID}`,
          name: item.name || item.longDescription || '',
          store: 'keells',
          storeName: 'Keells',
          price: item.amount || 0,
          priceFormatted: `Rs ${(item.amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`,
          image: item.imageUrl || '',
          url: searchUrl,
          inStock: item.isAvailable && (item.stockInHand || 0) > 0,
          category: item.categoryCode || '',
        }));
        return mapped;
      }
    } finally {
      clearTimeout(timeoutId);
      this.page.removeListener('response', handler);
    }

    return [];
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.ready = false;
  }
}

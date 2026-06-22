import { chromium } from 'playwright';

const CARGILLS_URL = 'https://cargillsonline.com';

export class CargillsConnector {
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
    this.ready = true;
  }

  async search(query, { itemsPerPage = 20 } = {}) {
    if (!this.ready) await this.init();

    const searchUrl = `${CARGILLS_URL}/product/${encodeURIComponent(query)}?PS=${encodeURIComponent(query)}`;

    let resolveResponse;
    const responsePromise = new Promise(resolve => { resolveResponse = resolve; });
    const handler = async (res) => {
      const url = res.url();
      if (url.includes('GetMenuCategoryItemsPagingV3')) {
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
      if (data && Array.isArray(data) && data.length > 0 && data[0].ItemName && data[0].ItemName !== 'No Products Found') {
        const mapped = data.map(item => ({
          id: `cargills-${item.Id}`,
          name: item.ItemName || '',
          store: 'cargills',
          storeName: 'Cargills',
          price: parseFloat(String(item.Price || '0').replace(/,/g, '')) || 0,
          priceFormatted: `Rs ${(parseFloat(String(item.Price || '0').replace(/,/g, '')) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`,
          image: item.ItemImage || item.WebImage || '',
          url: searchUrl,
          inStock: item.Inventory > 0 && item.IsActive !== '0',
          category: item.CategoryCode || '',
          unit: item.UnitSize ? `${item.UnitSize} ${item.UOM || ''}`.trim() : '',
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

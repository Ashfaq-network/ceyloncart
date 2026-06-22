import { chromium } from 'playwright';

const ENDPOINTS = [
  // Product endpoints
  '/1.0/Product/GetProducts',
  '/1.0/Product/GetItemDetails',
  '/1.0/Product/Search',
  '/1.0/Product/SearchProduct',
  '/1.0/Product/ListProducts',
  '/1.0/Product/ProductListing',
  '/1.0/Product/ProductSearch',
  '/1.0/Product/GetProductListing',
  '/1.0/Product/GetProductList',
  '/1.0/Product/ListItemDetails',
  '/1.0/Product/LoadProducts',
  '/1.0/Product/FilterProducts',
  
  // Web endpoints
  '/1.0/Web/GetProducts',
  '/1.0/Web/SearchProduct',
  '/1.0/Web/SearchProducts',
  '/1.0/Web/ProductSearch',
  '/1.0/Web/ProductListing',
  '/1.0/Web/ListItemDetails',
  '/1.0/Web/GetItemDetails',
  '/1.0/Web/FilterProducts',
  '/1.0/Web/GetFilteredProducts',
  '/1.0/Web/Search',
  
  // WebV2 endpoints
  '/1.0/WebV2/GetProducts',
  '/1.0/WebV2/SearchProduct',
  '/1.0/WebV2/ProductSearch',
  '/1.0/WebV2/ProductListing',
  '/1.0/WebV2/ListItemDetails',
  '/1.0/WebV2/GetItemDetails',
  
  // Item endpoints
  '/1.0/Item/GetItems',
  '/1.0/Item/SearchItems',
  '/1.0/Item/ListItemDetails',
  '/1.0/Item/GetItemDetails',
];

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Visit home page first to get CF cookies
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Guest login
  const loginResp = await page.evaluate(async () => {
    const r = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const d = await r.json();
    return d.result?.userSessionID;
  });
  
  console.log('Session:', loginResp);

  // Test all endpoints
  for (const ep of ENDPOINTS) {
    const url = `https://zebraliveback.keellssuper.com${ep}?searchTerm=rice&searchType=4&listBy=4`;
    try {
      const result = await page.evaluate(async (url) => {
        const r = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'usersessionid': sessionStorage.getItem('lastSession') || '',
          },
        });
        return { status: r.status, body: (await r.text()).substring(0, 200) };
      }, url);
      console.log(`${result.status} ${ep}`);
      if (result.status === 200) {
        console.log('  BODY:', result.body);
      }
    } catch (e) {
      console.log(`ERR ${ep}: ${e.message}`);
    }
  }

  await browser.close();
}

discover().catch(console.error);

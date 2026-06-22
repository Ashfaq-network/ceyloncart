import { chromium } from 'playwright';

const ENDPOINTS = [
  '/1.0/Product/GetProducts',
  '/1.0/Product/ListItemDetails',
  '/1.0/Product/GetItemDetails',
  '/1.0/Product/ProductListing',
  '/1.0/Product/SearchProduct',
  '/1.0/Web/ListItemDetails',
  '/1.0/Web/GetProducts',
  '/1.0/Web/SearchProduct',
  '/1.0/Web/ProductListing',
  '/1.0/WebV2/ListItemDetails',
  '/1.0/Item/ListItemDetails',
  '/1.0/Item/GetItemDetails',
];

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Visit home page to get CF cookies
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Guest login and probe all endpoints
  const results = await page.evaluate(async (endpoints) => {
    // Guest login
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sid = loginData.result?.userSessionID;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'usersessionid': sid,
    };

    const results = [];
    for (const ep of endpoints) {
      try {
        const url = `https://zebraliveback.keellssuper.com${ep}?listBy=4&searchTerm=rice&locationCode=SCDR&pageSize=10&page=1`;
        const res = await fetch(url, { headers });
        const text = await res.text();
        results.push({ ep, status: res.status, body: text.substring(0, 300) });
      } catch (e) {
        results.push({ ep, status: 'err', body: e.message });
      }
    }
    return { sessionId: sid, results };
  }, ENDPOINTS);

  console.log('Session:', results.sessionId);
  for (const r of results.results) {
    console.log(`${r.status} ${r.ep}`);
    if (r.status === 200) {
      console.log('  => ' + r.body);
    } else if (r.body) {
      console.log('  => ' + r.body);
    }
  }

  await browser.close();
}

discover().catch(console.error);

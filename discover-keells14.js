import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Handle the navigation that happens after cloudflare challenge
  let settled = false;
  page.on('framenavigated', () => { settled = false; });
  page.on('load', () => { settled = true; });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for the page to be interactive - wait for a known element
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => {
      return document.readyState === 'complete' && document.body?.innerText?.length > 0;
    }).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1000);
  }
  
  console.log('Page state:', await page.evaluate(() => document.readyState).catch(() => 'error'));
  const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => -1);
  console.log(`Body text length: ${bodyLen}`);

  const endpoints = [
    { path: '/1.0/Product/GetProducts', params: 'listBy=4&searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Product/ListItemDetails', params: 'itemID=0&listBy=4&searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Web/ListItemDetails', params: 'searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/WebV2/ListItemDetails', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/Product/SearchProduct', params: 'searchTerm=rice&locationCode=SCDR' },
  ];

  const results = await page.evaluate(async (opts) => {
    const { endpoints } = opts;
    
    // Guest login
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'usersessionid': sessionId,
    };

    const out = [{ sessionId }];
    for (const { path, params } of endpoints) {
      const url = `https://zebraliveback.keellssuper.com${path}?${params}`;
      try {
        const res = await fetch(url, { headers });
        const text = await res.text();
        out.push({ path, status: res.status, body: text.substring(0, 1000) });
      } catch (e) {
        out.push({ path, status: 'ERR', body: e.message });
      }
    }
    return out;
  }, { endpoints });

  for (const r of results) {
    if (r.sessionId) {
      console.log(`\nSession: ${r.sessionId}`);
      continue;
    }
    console.log(`\n${r.status} ${r.path}`);
    if (r.body) console.log('  =>', r.body.substring(0, 500));
  }

  await browser.close();
}

discover().catch(console.error);

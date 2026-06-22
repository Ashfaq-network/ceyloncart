import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Navigate to Keells
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Waiting for page to settle...');
  await page.waitForTimeout(5000);

  // Get all cookies
  const cookies = await context.cookies();
  console.log('Cookies:', cookies.map(c => c.name).join(', '));

  // Now probe ALL possible endpoints via page.evaluate (which uses browser fetch)
  const endpoints = [
    { path: '/1.0/Product/GetProducts', params: 'listBy=4&searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Product/ListItemDetails', params: 'itemID=0&listBy=4&searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Product/GetItemDetails', params: 'itemID=0&listBy=4&searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/Web/SearchProduct', params: 'searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Web/ListItemDetails', params: 'searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/WebV2/ListItemDetails', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/Product/ProductListing', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
  ];

  // First, guest login
  const loginResult = await page.evaluate(async () => {
    const r = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const d = await r.json();
    return { sessionId: d.result?.userSessionID, outletCode: d.result?.preferredOutlet || 'SCDR' };
  });
  console.log(`\nSession: ${loginResult.sessionId}, Outlet: ${loginResult.outletCode}`);

  // Now probe endpoints using browser fetch
  const results = await page.evaluate(async (opts) => {
    const { endpoints, sessionId } = opts;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'usersessionid': sessionId,
    };
    const out = [];
    for (const { path, params } of endpoints) {
      const url = `https://zebraliveback.keellssuper.com${path}?${params}`;
      try {
        const res = await fetch(url, { headers });
        const text = await res.text();
        out.push({ path, status: res.status, body: text.substring(0, 500) });
      } catch (e) {
        out.push({ path, status: 'ERR', body: e.message });
      }
    }
    return out;
  }, { endpoints, sessionId: loginResult.sessionId });

  for (const r of results) {
    console.log(`\n${r.status} ${r.path}`);
    if (r.status === 200 && r.body) console.log('  =>', r.body);
    else if (r.body) console.log('  =>', r.body.substring(0, 200));
  }

  await browser.close();
}

discover().catch(console.error);

import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Page 1: Visit Keells to get CF cookies
  const cookiePage = await context.newPage();
  await cookiePage.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for Cloudflare challenge to complete
  try {
    await cookiePage.waitForNavigation({ timeout: 15000 });
  } catch {}
  
  await cookiePage.waitForTimeout(3000);
  console.log('Cookies:', (await context.cookies()).map(c => c.name).join(', '));

  // Page 2: Blank page for API calls (same context = same cookies)
  const apiPage = await context.newPage();
  await apiPage.goto('about:blank');

  // Probe endpoints via page.evaluate
  const endpoints = [
    { path: '/1.0/Product/GetProducts', params: 'listBy=4&searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Product/ListItemDetails', params: 'itemID=0&listBy=4&searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Web/SearchProduct', params: 'searchTerm=rice&locationCode=SCDR&page=1&pageSize=10' },
    { path: '/1.0/Web/ListItemDetails', params: 'searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/WebV2/ListItemDetails', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
    { path: '/1.0/Product/ProductListing', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
  ];

  const results = await apiPage.evaluate(async (opts) => {
    const { endpoints } = opts;
    
    // Guest login
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;
    const outlet = loginData.result?.preferredOutlet || 'SCDR';

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'usersessionid': sessionId,
    };

    const out = [{ sessionId, outlet }];
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
  }, { endpoints });

  for (const r of results) {
    if (r.sessionId) {
      console.log(`\nSession: ${r.sessionId}, Outlet: ${r.outlet}`);
      continue;
    }
    console.log(`\n${r.status} ${r.path}`);
    if (r.status === 200 && r.body) console.log('  =>', r.body);
    else if (r.body) console.log('  =>', r.body.substring(0, 200));
  }

  await browser.close();
}

discover().catch(console.error);

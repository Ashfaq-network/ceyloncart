import { chromium } from 'playwright';

const ENDPOINTS = [
  { path: '/1.0/Product/GetProducts', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Product/ListItemDetails', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Product/GetItemDetails', params: 'listBy=4&searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Product/ProductListing', params: 'searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Product/SearchProduct', params: 'searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Web/SearchProduct', params: 'searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Web/ListItemDetails', params: 'searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Web/GetProducts', params: 'searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/WebV2/ListItemDetails', params: 'searchTerm=rice&locationCode=SCDR' },
  { path: '/1.0/Item/ListItemDetails', params: 'searchTerm=rice' },
  { path: '/1.0/Common/SearchProducts', params: 'searchTerm=rice' },
  { path: '/1.0/Web/GetInitialDataCollection', params: 'locationCode=SCDR&shippingDetailsId=0' },
];

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Create a new page for API calls
  const apiPage = await context.newPage();

  // Visit Keells in a separate page to establish cookies
  const mainPage = await context.newPage();
  await mainPage.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mainPage.waitForTimeout(4000);

  // Get Cloudflare cookies
  const cookies = await context.cookies();
  console.log('CF Cookies:', cookies.filter(c => c.name.includes('cf_') || c.name.includes('__cf')).map(c => c.name));

  // Now use apiPage (same context = same cookies) to probe endpoints
  for (const { path, params } of ENDPOINTS) {
    try {
      const url = `https://zebraliveback.keellssuper.com${path}?${params}`;
      const resp = await apiPage.request.get(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      const status = resp.status();
      const body = await resp.text();
      console.log(`${status} ${path}`);
      if (status === 200) {
        console.log('  =>', body.substring(0, 300));
      }
    } catch (e) {
      console.log(`ERR ${path}: ${e.message}`);
    }
  }

  // Now try with guest login + session
  console.log('\n--- With guest login ---');
  const loginResp = await apiPage.request.post('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    data: '{}',
  });
  const loginData = await loginResp.json();
  const sessionId = loginData.result?.userSessionID;
  console.log('Session:', sessionId);

  // If login data has preferredOutlet, use that
  const outletCode = loginData.result?.preferredOutlet || 'SCDR';
  console.log('Outlet:', outletCode);

  for (const { path, params } of ENDPOINTS) {
    try {
      const url = `https://zebraliveback.keellssuper.com${path}?${params}&locationCode=${outletCode}`;
      const resp = await apiPage.request.get(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'usersessionid': sessionId,
        },
      });
      const status = resp.status();
      const body = await resp.text();
      console.log(`${status} ${path}`);
      if (status === 200) {
        console.log('  =>', body.substring(0, 400));
      }
    } catch (e) {
      console.log(`ERR ${path}: ${e.message}`);
    }
  }

  await browser.close();
}

discover().catch(console.error);

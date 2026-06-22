import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // First visit the site to get Cloudflare clearance
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Now try direct API calls through the browser context
  // First: Guest login
  const loginResp = await page.request.post('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
    data: {},
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const loginData = await loginResp.json();
  const sessionId = loginData.result?.userSessionID;
  console.log('Session ID:', sessionId);

  // Now try search with the session
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'usersessionid': sessionId,
  };

  // Try various search endpoints
  const endpoints = [
    '/1.0/Product/SearchProduct',
    '/1.0/Product/GetProducts',
    '/1.0/Web/SearchProduct',
    '/1.0/WebV2/SearchProduct',
  ];

  for (const ep of endpoints) {
    const url = `https://zebraliveback.keellssuper.com${ep}?searchTerm=rice`;
    const resp = await page.request.get(url, { headers });
    const body = await resp.text();
    console.log(`\n${resp.status()} ${ep}:`, body.substring(0, 500));
  }

  // Also try the GetSuggestedItems endpoint
  const suggestResp = await page.request.get(
    'https://zebraliveback.keellssuper.com/1.0/Web/GetSuggestedItems?locationCode=SCDR',
    { headers }
  );
  console.log('\nSuggested items:', (await suggestResp.text()).substring(0, 500));

  await browser.close();
}

discover().catch(console.error);

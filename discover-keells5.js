import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Listen for API responses
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('zebraliveback') && !url.includes('signalr') && !url.includes('notification')) {
      const body = await resp.text();
      console.log(`\n${resp.status()} ${url}`);
      console.log('  body:', body.substring(0, 300));
    }
  });

  // Navigate and wait for the app to initialize
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Waiting for page to initialize...');
  await page.waitForTimeout(8000);

  // Now use the browser's fetch to call APIs (has all cookies)
  const results = await page.evaluate(async () => {
    // Guest login
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;

    // Search for products
    const searchRes = await fetch(
      'https://zebraliveback.keellssuper.com/1.0/Product/GetProducts?listBy=4&searchTerm=rice&locationCode=SCDR',
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'usersessionid': sessionId,
        },
      }
    );
    const searchData = await searchRes.text();
    
    return { sessionId, searchStatus: searchRes.status, searchData: searchData.substring(0, 1000) };
  });

  console.log('\n=== RESULTS ===');
  console.log('Session:', results.sessionId);
  console.log('Search status:', results.searchStatus);
  console.log('Search data:', results.searchData);

  await browser.close();
}

discover().catch(console.error);

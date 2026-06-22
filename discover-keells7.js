import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Navigate to Keells
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Check cookies
  const cookies = await context.cookies();
  console.log('Cookies:', cookies.map(c => `${c.name}=${c.value.substring(0, 50)}`));

  // Check localStorage for Redux state
  const state = await page.evaluate(() => {
    const raw = localStorage.getItem('persist:root');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch { return raw.substring(0, 500); }
  });
  console.log('\nRedux persist root:', JSON.stringify(state, null, 2).substring(0, 2000));

  // Check if there's a specific state key for API config
  const apiConfig = await page.evaluate(() => {
    // Look for the redux state that has API config
    const raw = sessionStorage.getItem('persist:root');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const result = {};
      for (const [k, v] of Object.entries(parsed)) {
        try { result[k] = JSON.parse(v); } catch { result[k] = v.substring(0, 100); }
      }
      return result;
    } catch { return null; }
  });
  console.log('\nSession config:', JSON.stringify(apiConfig, null, 2).substring(0, 3000));

  // Try to find all available API methods
  const config = await page.request.get('https://zebraliveback.keellssuper.com/1.0/Common/GetSystemConfiguration', {
    headers: { 'Accept': 'application/json' },
  });
  console.log('\nSystem config:', (await config.text()).substring(0, 2000));

  await browser.close();
}

discover().catch(console.error);

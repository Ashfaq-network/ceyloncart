import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Log all network requests
  const seen = new Set();
  page.on('request', req => {
    const url = req.url();
    if ((url.includes('zebraliveback') || url.includes('api/')) && !seen.has(url)) {
      seen.add(url);
      console.log('>>>', req.method(), url);
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if ((url.includes('zebraliveback') || url.includes('api/')) && !seen.has(url)) {
      seen.add(url);
      let body = '';
      try { body = await resp.text(); } catch {}
      console.log('<<<', resp.status(), url, body.substring(0, 500));
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Page loaded, waiting for API calls...');
  await page.waitForTimeout(10000);

  // Check localStorage and sessionStorage
  const storage = await page.evaluate(() => {
    return {
      localStorage: Object.entries(localStorage).map(([k, v]) => ({ k, v: v.substring(0, 100) })),
      sessionStorage: Object.entries(sessionStorage).map(([k, v]) => ({ k, v: v.substring(0, 100) })),
    };
  });
  console.log('STORAGE:', JSON.stringify(storage, null, 2));

  // Try searching if there's a search box
  const searchInput = await page.$('input[type="text"], input[placeholder*="search" i], input[placeholder*="Search" i], input[name="q"], input[name="search"]');
  if (searchInput) {
    const placeholder = await searchInput.getAttribute('placeholder');
    console.log('Search input found:', placeholder);
    
    // Type and search
    await searchInput.click();
    await searchInput.fill('rice');
    await page.waitForTimeout(2000);

    // Check for any API responses after typing
    const apiCalls = await page.evaluate(() => {
      return window.performance.getEntriesByType('resource')
        .filter(e => e.name.includes('zebraliveback') || e.name.includes('api/'))
        .map(e => ({ url: e.name, type: e.initiatorType }));
    });
    console.log('API calls after search:', JSON.stringify(apiCalls, null, 2));
  }

  // Try to extract initial app state (Redux state)
  const reduxState = await page.evaluate(() => {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) return JSON.parse(el.textContent);
    } catch {}
    // Try finding Redux store
    try {
      const root = document.querySelector('#root')?._reactRootContainer?._internalRoot?.current;
      return 'Redux state found via React devtools';
    } catch {}
    return null;
  });
  console.log('Initial state:', reduxState);

  // Wait a bit then check what's visible
  await page.waitForTimeout(3000);
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('PAGE TEXT:', bodyText);

  await browser.close();
}

discover().catch(console.error);

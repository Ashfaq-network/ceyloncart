import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Intercept ALL requests and responses
  page.on('response', async res => {
    if (res.url().includes('zebraliveback')) {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json')) {
        try {
          const json = await res.json();
          console.log('RESP', res.status(), res.url().split('?')[0].split('/').pop());
          if (json.result?.userSessionID) {
            console.log('  SESSION:', json.result.userSessionID);
          }
        } catch {}
      }
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check what's in the page context after load
  const pageData = await page.evaluate(() => {
    const result = {};
    
    // Check sessionStorage
    try {
      const keys = Object.keys(sessionStorage);
      result.sessionKeys = keys;
      for (const k of keys) {
        const val = sessionStorage.getItem(k);
        result[k] = val.substring(0, 200);
      }
    } catch (e) { result.sessionError = e.message; }
    
    // Check localStorage
    try {
      const keys = Object.keys(localStorage);
      result.localKeys = keys;
      for (const k of keys) {
        const val = localStorage.getItem(k);
        result[k] = val.substring(0, 200);
      }
    } catch (e) { result.localError = e.message; }
    
    // Check window for any global state
    result.hasRedux = typeof window.__REDUX_DEVTOOLS_EXTENSION__ !== 'undefined';
    
    return result;
  });
  
  console.log('\nPage state:');
  for (const [k, v] of Object.entries(pageData)) {
    console.log(`  ${k}:`, typeof v === 'string' ? v.substring(0, 150) : JSON.stringify(v).substring(0, 150));
  }

  // Now click search and type something, check what happens
  const searchInput = await page.$('input[placeholder="Search on Keells Online"]');
  if (searchInput) {
    await searchInput.click();
    await page.waitForTimeout(300);
    
    // Type "rice" character by character
    await searchInput.fill('rice');
    await page.waitForTimeout(500);
    
    // Press Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Check the cookies after auth
    const cookies = await context.cookies();
    console.log('\nCookies after search:');
    for (const c of cookies) {
      if (c.name.includes('auth') || c.name.includes('session') || c.name.includes('.AspNet')) {
        console.log(`  ${c.name}: ${c.value.substring(0, 50)}`);
      }
    }
  }

  await browser.close();
}

discover().catch(console.error);

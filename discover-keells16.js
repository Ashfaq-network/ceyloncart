import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Capture ALL XHR requests with full URLs
  const seen = new Set();
  page.on('request', req => {
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      const url = req.url();
      if (url.includes('zebraliveback') && !seen.has(url)) {
        seen.add(url);
        console.log('XHR:', req.method(), url);
      }
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for page to be interactive
  for (let i = 0; i < 20; i++) {
    const hasSearch = await page.evaluate(() => {
      const el = document.querySelector('input[placeholder="Search on Keells Online"]');
      return !!el && el.offsetParent !== null;
    }).catch(() => false);
    if (hasSearch) break;
    await page.waitForTimeout(1000);
  }
  
  console.log('\n--- Page ready, clicking search ---');

  // Find and click the search input
  const searchInput = await page.$('input[placeholder="Search on Keells Online"]');
  if (searchInput) {
    await searchInput.click();
    await searchInput.fill('rice');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    
    console.log('--- Waiting for search results ---');
    await page.waitForTimeout(5000);
    
    // Check if there's a new API call
    console.log('--- Search complete ---');
    
    // Try to get page content now
    const text = await page.evaluate(() => document.body.innerText.substring(0, 1000));
    console.log('Page text after search:', text);
    
    // Check URL
    const url = page.url();
    console.log('Current URL:', url);
  }

  await browser.close();
}

discover().catch(console.error);

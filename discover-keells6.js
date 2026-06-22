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
    if (url.includes('zebraliveback')) {
      // Don't log every call, just the ones after we navigate
      console.log(`[${resp.status()}] ${url}`);
    }
  });

  // First visit the home page to get cookies
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Home page loaded, waiting...');
  await page.waitForTimeout(4000);

  // Now navigate to search page directly
  console.log('\n--- Navigating to search page ---');
  await page.goto('https://keellssuper.com/product?cat=4&s=~rice', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  await page.waitForTimeout(8000);

  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nPage text:', pageText);

  await browser.close();
}

discover().catch(console.error);

import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Capture the search REQUEST headers
  page.on('request', req => {
    if (req.url().includes('GetItemDetails')) {
      console.log('=== SEARCH REQUEST HEADERS ===');
      const headers = req.headers();
      for (const [k, v] of Object.entries(headers)) {
        console.log(`  ${k}: ${v.substring(0, 100)}`);
      }
      console.log('=== END ===');
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for app to init
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => {
      const el = document.querySelector('input[placeholder="Search on Keells Online"]');
      return !!el;
    }).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1000);
  }
  
  // Click search and type
  const searchInput = await page.$('input[placeholder="Search on Keells Online"]');
  if (searchInput) {
    await searchInput.click();
    await page.waitForTimeout(200);
    await searchInput.fill('rice');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  }

  await browser.close();
}

discover().catch(console.error);

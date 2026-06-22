import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Capture the search response
  let searchResponse = null;
  page.on('response', async res => {
    if (res.url().includes('GetItemDetails')) {
      const text = await res.text();
      searchResponse = { status: res.status(), url: res.url(), headers: res.headers(), body: text.substring(0, 5000) };
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
    
    // Wait for results
    for (let i = 0; i < 20; i++) {
      if (searchResponse) break;
      await page.waitForTimeout(1000);
    }
  }

  if (searchResponse) {
    console.log('Search API response:');
    console.log('Status:', searchResponse.status);
    console.log('Headers:', JSON.stringify(searchResponse.headers, null, 2));
    console.log('Body:', searchResponse.body.substring(0, 3000));
  } else {
    console.log('No search API response captured');
  }

  await browser.close();
}

discover().catch(console.error);

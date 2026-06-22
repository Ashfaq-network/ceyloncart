import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  let searchReqHeaders = null;
  let searchResBody = null;

  page.on('request', req => {
    if (req.url().includes('GetItemDetails')) {
      searchReqHeaders = req.headers();
    }
  });
  page.on('response', async res => {
    if (res.url().includes('GetItemDetails')) {
      try { searchResBody = await res.text(); } catch {}
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Page loaded');
  
  // Wait for search input
  for (let i = 0; i < 20; i++) {
    const exists = await page.evaluate(() => 
      document.querySelector('input[placeholder="Search on Keells Online"]') !== null
    ).catch(() => false);
    if (exists) { console.log('Search input found'); break; }
    console.log(`Waiting... ${i+1}`);
    await page.waitForTimeout(1000);
  }
  
  // Get all text content on page to see what's loaded
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Page text:', bodyText);
  
  const searchInput = await page.$('input[placeholder="Search on Keells Online"]');
  if (!searchInput) {
    console.log('No search input found!');
    await browser.close();
    return;
  }

  await searchInput.click();
  await page.waitForTimeout(200);
  await searchInput.fill('rice');
  await page.waitForTimeout(500);
  
  // Try pressing Enter
  await page.keyboard.press('Enter');
  console.log('Pressed Enter');
  
  // Wait for results
  for (let i = 0; i < 30; i++) {
    if (searchResBody) break;
    await page.waitForTimeout(1000);
  }

  if (searchReqHeaders) {
    console.log('\nSearch request headers:');
    for (const [k, v] of Object.entries(searchReqHeaders)) {
      console.log(`  ${k}: ${v}`);
    }
  } else {
    console.log('No search request detected');
  }

  if (searchResBody) {
    console.log('\nSearch response (first 1000 chars):');
    console.log(searchResBody.substring(0, 1000));
  }

  const currentUrl = page.url();
  console.log('\nCurrent URL:', currentUrl);

  await browser.close();
}

discover().catch(console.error);

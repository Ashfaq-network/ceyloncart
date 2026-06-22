import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Log ALL API requests
  page.on('request', req => {
    const url = req.url();
    if (url.includes('zebraliveback')) {
      console.log('REQ:', req.method(), url);
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('zebraliveback')) {
      const body = await resp.text();
      console.log('RES:', resp.status(), url, body.substring(0, 300));
    }
  });

  // Navigate to Keells
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('--- Page loaded, waiting 5s ---');
  await page.waitForTimeout(5000);

  // Try to interact with search
  const searchInput = await page.$('input[type="text"]');
  if (searchInput) {
    console.log('Search input found, typing "rice"...');
    await searchInput.click();
    await searchInput.fill('rice');
    await page.waitForTimeout(2000);
    
    // Try pressing Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    console.log('--- After search ---');
  } else {
    console.log('No search input found on page');
    // Try dumping all input elements
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type,
        placeholder: i.placeholder,
        id: i.id,
        className: i.className,
      }));
    });
    console.log('Inputs:', JSON.stringify(inputs, null, 2));
  }

  const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Page text:', text);

  await browser.close();
}

discover().catch(console.error);

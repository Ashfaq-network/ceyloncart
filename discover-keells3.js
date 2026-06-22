import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Log ALL API requests with headers
  page.on('request', req => {
    const url = req.url();
    if (url.includes('zebraliveback') && !url.includes('FunctionHandle') && !url.includes('signalr') && !url.includes('notification')) {
      const headers = req.headers();
      console.log('<<<', req.method(), url);
      console.log('    headers:', JSON.stringify({
        usersessionid: headers['usersessionid'],
        cookie: (headers['cookie'] || '').substring(0, 100),
      }));
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('zebraliveback') && !url.includes('FunctionHandle') && !url.includes('signalr') && !url.includes('notification')) {
      const body = await resp.text();
      console.log('>>>', resp.status(), url);
      console.log('    body:', body.substring(0, 400));
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('--- Page loaded, waiting 8s ---');
  await page.waitForTimeout(8000);

  // Try to interact with search
  const searchBox = await page.$('input[placeholder*="earch" i]');
  if (!searchBox) {
    // Dump all input elements
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type,
        placeholder: i.placeholder,
        className: i.className.substring(0, 50),
      }));
    });
    console.log('All inputs:', JSON.stringify(inputs, null, 2));
  } else {
    console.log('Found search box, searching for rice...');
    await searchBox.click();
    await searchBox.fill('rice');
    await page.waitForTimeout(1500);

    // Try pressing Enter or clicking search button
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    console.log('--- After search ---');
  }

  await browser.close();
}

discover().catch(console.error);

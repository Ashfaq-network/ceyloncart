import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  const searchRequests = [];
  page.on('request', req => {
    if (req.url().includes('GetItemDetails') || req.url().includes('ItemDetails')) {
      searchRequests.push({
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        postData: req.postData(),
      });
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for app
  for (let i = 0; i < 20; i++) {
    const exists = await page.evaluate(() => 
      document.querySelector('input[placeholder="Search on Keells Online"]') !== null
    ).catch(() => false);
    if (exists) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('App loaded, triggering search...');
  
  const searchInput = await page.$('input[placeholder="Search on Keells Online"]');
  if (searchInput) {
    await searchInput.click();
    await new Promise(r => setTimeout(r, 200));
    await searchInput.fill('rice');
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');
    
    // Wait for a few seconds
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\nCaptured ${searchRequests.length} search requests:`);
  for (const req of searchRequests) {
    console.log('\n--- Request ---');
    console.log('URL:', req.url);
    console.log('Key headers:');
    for (const k of ['usersessionid', 'accept', 'content-type', 'x-frame-options']) {
      if (req.headers[k]) console.log(`  ${k}: ${req.headers[k]}`);
    }
  }

  // Also check what session was created during initial page load
  const guestLoginResponses = [];
  page.on('response', async res => {
    if (res.url().includes('GuestLogin')) {
      try {
        const json = await res.json();
        guestLoginResponses.push(json.result?.userSessionID);
      } catch {}
    }
  });

  // Now check page URL
  console.log('\nCurrent URL:', page.url());

  // Check if there's a getInitialData call with the search
  const allSearchRequests = [];
  page.on('request', req => {
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      allSearchRequests.push(req.url());
    }
  });

  // Reload and check all XHR calls during search
  console.log('\n\n=== FULL RELOAD WITH ALL XHR LOGGING ===');
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for app, search, then log
  for (let i = 0; i < 20; i++) {
    const exists = await page.evaluate(() => 
      document.querySelector('input[placeholder="Search on Keells Online"]') !== null
    ).catch(() => false);
    if (exists) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  const searchInput2 = await page.$('input[placeholder="Search on Keells Online"]');
  if (searchInput2) {
    await searchInput2.click();
    await new Promise(r => setTimeout(r, 200));
    await searchInput2.fill('sugar');
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 5000));
  }
  
  console.log('\nAll XHR during search:');
  for (const url of allSearchRequests) {
    console.log(' ', url);
  }

  await browser.close();
}

discover().catch(console.error);

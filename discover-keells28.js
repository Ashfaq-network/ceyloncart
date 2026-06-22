import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Get ALL JS file URLs
  const jsFiles = [];
  page.on('request', req => {
    if (req.url().includes('.js')) {
      jsFiles.push(req.url().split('/').pop().split('?')[0]);
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check app JS bundle
  console.log('JS files:');
  for (const f of jsFiles) {
    if (f.includes('chunk') || f.includes('main') || f.includes('vendor') || f.includes('app')) {
      console.log(' ', f.substring(0, 80));
    }
  }

  // Search for the API service in the JS code
  const apiServiceCode = await page.evaluate(() => {
    // Try to find the axios/fetch wrapper
    // Look for references to GetItemDetails
    const scripts = document.querySelectorAll('script[src]');
    return Array.from(scripts).map(s => s.src).filter(s => s.includes('.js'));
  });
  console.log('\nScript tags:', apiServiceCode.length);

  // Let's try a completely different approach: intercept the API response
  // and extract the JSON, then find the session ID that was used
  
  // Click search and capture the request with ALL details
  const searchPromise = new Promise(resolve => {
    page.on('request', req => {
      if (req.url().includes('GetItemDetails')) {
        resolve({
          method: req.method(),
          url: req.url(),
          headers: req.headers(),
          postData: req.postData(),
        });
      }
    });
  });

  const searchInput = await page.$('input[placeholder="Search on Keells Online"]');
  if (searchInput) {
    await searchInput.click();
    await new Promise(r => setTimeout(r, 200));
    await searchInput.fill('rice');
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');
    
    const reqDetails = await Promise.race([
      searchPromise,
      new Promise(r => setTimeout(() => r(null), 15000)),
    ]);
    
    if (reqDetails) {
      console.log('\n=== SEARCH REQUEST DETAILS ===');
      console.log('Method:', reqDetails.method);
      console.log('URL:', reqDetails.url);
      console.log('Headers:');
      for (const [k, v] of Object.entries(reqDetails.headers)) {
        console.log(`  ${k}: ${v}`);
      }
      console.log('Post data:', reqDetails.postData);
    }

    // Wait and check the URL
    await new Promise(r => setTimeout(r, 3000));
    console.log('\nFinal URL:', page.url());
  }

  // Now compare: try an XHR request the "old way"
  console.log('\n=== Testing XHR vs Fetch ===');
  const xhrTest = await page.evaluate(async () => {
    // Test 1: XMLHttpRequest
    const xhrResult = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://zebraliveback.keellssuper.com/1.0/Common/GetSystemConfiguration');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText.substring(0, 100) });
      xhr.onerror = () => resolve({ error: 'XHR failed' });
      xhr.send();
    });

    // Test 2: fetch with no custom headers  
    const fetchResult = await fetch('https://zebraliveback.keellssuper.com/1.0/Common/GetSystemConfiguration', {
      headers: { 'Accept': 'application/json' },
    });
    
    return {
      xhr: xhrResult,
      fetch: { status: fetchResult.status, text: (await fetchResult.text()).substring(0, 100) },
    };
  });
  
  console.log('XHR test:', JSON.stringify(xhrTest.xhr, null, 2));
  console.log('Fetch test:', JSON.stringify(xhrTest.fetch, null, 2));

  await browser.close();
}

discover().catch(console.error);

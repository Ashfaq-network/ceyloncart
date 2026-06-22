import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Capture ALL chunk URLs
  const chunks = [];
  page.on('request', req => {
    if (req.url().includes('.chunk.js')) {
      chunks.push(req.url());
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('Chunks loaded:');
  for (const c of chunks) console.log(' ', c.split('/').pop());

  // Now extract module 12 from the chunk that loaded it
  // Check the main chunk for all module IDs
  const allModules = await page.evaluate(async () => {
    const results = [];
    
    // Try to access webpack's module registry
    // In many webpack builds, __webpack_require__ stores modules
    try {
      // The webpack JSONP array
      const jsonpArray = window.webpackJsonpjmsl_keells_online;
      if (jsonpArray) {
        results.push('jsonpArray found, length: ' + jsonpArray.length);
        // Look at the most recent entry
        for (let i = 0; i < jsonpArray.length; i++) {
          const entry = jsonpArray[i];
          if (entry && entry[1]) {
            const moduleIds = Object.keys(entry[1]);
            results.push('Entry ' + i + ' chunkId=' + entry[0] + ' modules: ' + moduleIds.join(','));
          }
        }
      }
    } catch(e) {
      results.push('Error: ' + e.message);
    }
    
    return results;
  });
  
  console.log('\nWebpack modules:');
  for (const r of allModules) console.log(' ', r);

  await browser.close();
}

discover().catch(console.error);

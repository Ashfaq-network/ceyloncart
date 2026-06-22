import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Log ALL XHR/fetch requests (not doc/images/css)
  page.on('request', req => {
    const type = req.resourceType();
    if (type === 'xhr' || type === 'fetch') {
      console.log('XHR:', req.method(), req.url());
    }
  });

  // First visit the home page
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('--- Home loaded, waiting for app init ---');
  await page.waitForTimeout(6000);

  // Try to find search elements
  const searchHtml = await page.evaluate(() => {
    // Find any element with search-related classes or attributes
    const all = document.querySelectorAll('*');
    const results = [];
    for (const el of all) {
      if (el.tagName === 'INPUT') {
        results.push({
          tag: el.tagName,
          type: el.type,
          placeholder: el.placeholder,
          id: el.id,
          className: el.className.substring(0, 60),
          rect: el.getBoundingClientRect(),
        });
      }
    }
    return results;
  });
  console.log('Input elements:', JSON.stringify(searchHtml, null, 2));

  // Also check if there are React root elements
  const reactInfo = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      hasRoot: !!root,
      rootChildren: root ? root.children.length : 0,
      rootHTML: root ? root.innerHTML.substring(0, 500) : 'none',
    };
  });
  console.log('React info:', JSON.stringify(reactInfo, null, 2));

  await browser.close();
}

discover().catch(console.error);

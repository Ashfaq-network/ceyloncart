import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Capture ALL XHR requests
  const apiCalls = [];
  page.on('request', req => {
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      apiCalls.push({ method: req.method(), url: req.url(), headers: req.headers() });
    }
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for page to fully render
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);
    if (len > 100) break;
    await page.waitForTimeout(1000);
  }

  console.log('Initial API calls:');
  for (const call of apiCalls) {
    if (call.url.includes('zebraliveback')) {
      console.log(`  ${call.method} ${call.url}`);
    }
  }

  // Look for search input and use it
  const searchInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
    return inputs.map(i => ({
      placeholder: i.placeholder,
      id: i.id,
      className: i.className.substring(0, 80),
      rect: {
        x: i.getBoundingClientRect().x,
        y: i.getBoundingClientRect().y,
        w: i.getBoundingClientRect().width,
        h: i.getBoundingClientRect().height,
      },
      visible: i.offsetParent !== null,
    }));
  });
  console.log('\nSearch inputs:', JSON.stringify(searchInfo, null, 2));

  // Also dump page title
  const title = await page.title();
  console.log('\nPage title:', title);

  // Get page HTML outline (just first 3000 chars)
  const htmlOutline = await page.evaluate(() => {
    const walk = (el, depth) => {
      if (depth > 3) return '';
      let out = '  '.repeat(depth) + '<' + el.tagName.toLowerCase();
      if (el.id) out += ' id="' + el.id + '"';
      if (el.className && typeof el.className === 'string') out += ' class="' + el.className.substring(0, 40) + '"';
      out += '>\n';
      for (const child of el.children) {
        out += walk(child, depth + 1);
      }
      return out;
    };
    return walk(document.body, 0).substring(0, 3000);
  });
  console.log('\nHTML outline:', htmlOutline);

  await browser.close();
}

discover().catch(console.error);

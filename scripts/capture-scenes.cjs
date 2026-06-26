process.env.LD_LIBRARY_PATH = '/tmp/libnspr4/usr/lib/x86_64-linux-gnu:/tmp/libnss3/usr/lib/x86_64-linux-gnu:/tmp/libasound/usr/lib/x86_64-linux-gnu';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = '/tmp/video-scenes';
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'https://grocerylk.vercel.app';

async function screenshot(page, name, opts = {}) {
  const filePath = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: opts.fullPage || false });
  console.log(`  ✓ ${name}.png`);
  return filePath;
}

async function typeSlow(page, sel, text) {
  await page.click(sel);
  await page.waitForTimeout(300);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 60 });
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/home/ashfaq/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    headless: true,
  });

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  // Scene 1: Homepage with loading spinner
  console.log('Scene 1: Loading spinner...');
  await page.goto(BASE, { waitUntil: 'commit', timeout: 15000 });
  await page.waitForTimeout(800);
  await screenshot(page, '01-loading');

  // Scene 2: Homepage fully loaded (scroll to top first)
  console.log('Scene 2: Homepage loaded...');
  await page.waitForSelector('.product-card, [class*="product"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await screenshot(page, '02-homepage');

  // Scene 3: Scroll down a bit
  console.log('Scene 3: Scrolling...');
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(800);
  await screenshot(page, '03-scroll');

  // Scene 4: Search for "Rice"
  console.log('Scene 4: Search for Rice...');
  const searchInput = await page.$('input[type="text"], input[placeholder*="search" i], input[placeholder*="Search" i]');
  if (searchInput) {
    await searchInput.click();
    await page.waitForTimeout(300);
    await searchInput.fill('');
    await typeSlow(page, 'input[type="text"], input[placeholder*="search" i], input[placeholder*="Search" i]', 'Rice');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    await screenshot(page, '04-rice-results');
  } else {
    // Navigate directly to search URL
    await page.goto(BASE + '/?search=Rice', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '04-rice-results');
  }

  // Scene 5: Comparison view (tap to compare)
  console.log('Scene 5: Comparison view...');
  const compareBtns = await page.$$('button:has-text("Compare"), button:has-text("compare"), [class*="compare"]');
  if (compareBtns.length > 0) {
    await compareBtns[0].click();
    await page.waitForTimeout(2000);
    await screenshot(page, '05-comparison');
  } else {
    // Just scroll for a different view
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500);
    await screenshot(page, '05-scroll-more');
  }

  // Scene 6: Share view
  console.log('Scene 6: Share view...');
  const shareBtns = await page.$$('button:has-text("Share"), button:has-text("share"), [class*="share"], [aria-label*="share" i]');
  if (shareBtns.length > 0) {
    // Just hover near it
    const box = await shareBtns[0].boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
    }
  }
  await screenshot(page, '06-share');

  // Scene 7: Final - back to homepage with a different product
  console.log('Scene 7: Another view...');
  await page.goto(BASE + '/?search=Cooking%20Oil', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, '07-cooking-oil');

  await browser.close();
  console.log('\nAll scenes captured!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

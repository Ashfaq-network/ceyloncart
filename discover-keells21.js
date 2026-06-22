import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Intercept ALL zebraliveback responses
  page.on('response', async res => {
    if (!res.url().includes('zebraliveback')) return;
    
    let text = '';
    try { text = await res.text(); } catch { text = '<no body>'; }
    
    console.log(`\n=== ${res.status()} ${res.url().split('?')[0].split('/').slice(-2).join('/')} ===`);
    console.log('Headers:', JSON.stringify(res.headers()));
    console.log('Body:', text.substring(0, 500));
  });

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('\n\n=== DONE ===');
  
  // Also dump sessionStorage
  const ss = await page.evaluate(() => {
    const raw = sessionStorage.getItem('persist:root');
    return raw ? raw.substring(0, 2000) : null;
  });
  console.log('Session storage:', ss);

  await browser.close();
}

discover().catch(console.error);

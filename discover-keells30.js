import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Capture GuestLogin session
  let guestSession = null;
  page.on('response', async res => {
    if (res.url().includes('GuestLogin')) {
      try { 
        const json = await res.json();
        guestSession = json.result?.userSessionID;
        console.log('GuestLogin session:', guestSession);
      } catch {}
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

  // Wait a bit more for GuestLogin to complete
  await new Promise(r => setTimeout(r, 3000));
  console.log('Guest session after wait:', guestSession);

  if (!guestSession) {
    // Fallback: make a fresh guest login
    const freshSession = await page.evaluate(async () => {
      const res = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      return data.result?.userSessionID;
    });
    console.log('Fresh guest session:', freshSession);
    guestSession = freshSession;
  }

  if (!guestSession) {
    console.log('Could not get session');
    await browser.close();
    return;
  }

  // Now call search WITHOUT Content-Type header (just like the app does)
  console.log('\n--- Calling search API without Content-Type ---');
  const result = await page.evaluate(async (sid) => {
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '3', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });

    const res = await fetch(
      `https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`,
      {
        headers: { 
          'Accept': 'application/json',
          'usersessionid': sid,
        },
      }
    );
    
    return { 
      status: res.status,
      ok: res.ok,
      body: (await res.text()).substring(0, 1000),
    };
  }, guestSession);

  console.log('Status:', result.status);
  console.log('OK:', result.ok);
  console.log('Body:', result.body);

  await browser.close();
}

discover().catch(console.error);

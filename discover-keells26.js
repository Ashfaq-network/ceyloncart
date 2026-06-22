import { chromium } from 'playwright';

// Test: can we call search directly using the app's own stored session?
async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for app to init
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => {
      const el = document.querySelector('input[placeholder="Search on Keells Online"]');
      return !!el;
    }).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1000);
  }

  // Now make the search call using the page's own fetch and session
  const result = await page.evaluate(async (searchTerm) => {
    // The app stores session in Redux/sessionStorage, but the actually used session
    // is obtained from the GuestLogin response and used directly by the app.
    // Let's try making the search call through the app's own axios instance:
    
    // Method 1: Try to get session from redux store
    let sessionId = null;
    try {
      const raw = sessionStorage.getItem('persist:root');
      if (raw) {
        const parsed = JSON.parse(raw);
        const ud = JSON.parse(parsed.userDetails || '{}');
        // The stored session is encrypted, but maybe we can find the real one?
        // Let's check what the app actually stores
        sessionId = ud.userSessionID;
      }
    } catch {}

    // Method 2: Just call the API directly, the React app might have set up
    // interceptors/axios that handle auth automatically
    // Let's try using fetch without any custom session header
    // (maybe the app sets it automatically via axios interceptor)
    
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '5', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: searchTerm, itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });

    // Try with encrypted session
    const res1 = await fetch(
      `https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`,
      {
        headers: { 'Accept': 'application/json', 'usersessionid': sessionId },
      }
    );
    const r1 = { status: res1.status, body: (await res1.text()).substring(0, 300) };

    // Try without any session header
    const res2 = await fetch(
      `https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`,
      {
        headers: { 'Accept': 'application/json' },
      }
    );
    const r2 = { status: res2.status, body: (await res2.text()).substring(0, 300) };

    return { 
      storedSession: sessionId?.substring(0, 40), 
      withSession: r1,
      withoutSession: r2,
    };
  }, 'rice');

  console.log('Results:');
  console.log('Stored session (encrypted):', result.storedSession);
  console.log('With session:', JSON.stringify(result.withSession, null, 2));
  console.log('Without session:', JSON.stringify(result.withoutSession, null, 2));

  await browser.close();
}

discover().catch(console.error);

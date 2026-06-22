import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Capture the session from the Redux store after the page loads
  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for the app to fully initialize
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => {
      try {
        const raw = sessionStorage.getItem('persist:root');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const userDetails = JSON.parse(parsed.userDetails || '{}');
        return !!userDetails.userSessionID;
      } catch { return false; }
    }).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1000);
  }

  // Get the session from the app
  const appState = await page.evaluate(() => {
    const raw = sessionStorage.getItem('persist:root');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = {};
    for (const [k, v] of Object.entries(parsed)) {
      try { result[k] = JSON.parse(v); } catch { result[k] = v; }
    }
    return result;
  });
  
  const sessionId = appState?.userDetails?.userSessionID;
  console.log('App session ID:', sessionId);

  if (!sessionId) {
    console.log('No session found!');
    await browser.close();
    return;
  }

  // Now make the search API call using this session
  const results = await page.evaluate(async (sessionId) => {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'usersessionid': sessionId,
    };

    const params = new URLSearchParams({
      pageNo: '1',
      itemsPerPage: '3',
      outletCode: 'SCDR',
      departmentId: '',
      subDepartmentId: '',
      categoryId: '',
      itemDescription: 'rice',
      itemPricefrom: '0',
      itemPriceTo: '5000',
      isFeatured: '0',
      isPromotionOnly: 'false',
      promotionCategory: '',
      sortBy: 'default',
      BrandId: '',
      storeName: '',
      subDeaprtmentCode: '',
      isShowOutofStockItems: 'true',
      brandName: '',
    });

    const searchRes = await fetch(
      `https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`,
      { headers }
    );
    const searchText = await searchRes.text();
    
    return {
      status: searchRes.status,
      body: searchText.substring(0, 3000),
    };
  }, sessionId);

  console.log('Search Status:', results.status);
  console.log('Search Body:', results.body);

  await browser.close();
}

discover().catch(console.error);

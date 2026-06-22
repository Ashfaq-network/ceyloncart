import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Now call the search API with the freshly created guest session
  const result = await page.evaluate(async () => {
    // First get a fresh guest session
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;
    console.log('Fresh session:', sessionId);

    // Try search with this session
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '5', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });

    const searchRes = await fetch(
      `https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'usersessionid': sessionId,
        },
      }
    );
    
    const status = searchRes.status;
    const text = await searchRes.text();
    return { status, sessionId, body: text.substring(0, 2000) };
  });

  console.log('Status:', result.status);
  console.log('Session:', result.sessionId);
  console.log('Body:', result.body);

  await browser.close();
}

discover().catch(console.error);

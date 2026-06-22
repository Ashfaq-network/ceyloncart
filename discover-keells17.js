import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('input[placeholder="Search on Keells Online"]')).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1000);
  }

  // Make the search API call via browser fetch and capture the response
  const results = await page.evaluate(async () => {
    // Guest login
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'usersessionid': sessionId,
    };

    // Search products
    const params = new URLSearchParams({
      pageNo: '1',
      itemsPerPage: '5',
      outletCode: 'SCDR',
      departmentId: '',
      subDepartmentId: '',
      categoryId: '',
      itemDescription: 'RICE',
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
      headers: Object.fromEntries(searchRes.headers.entries()),
      body: searchText.substring(0, 3000),
    };
  });

  console.log('Status:', results.status);
  console.log('Body:', results.body);

  await browser.close();
}

discover().catch(console.error);

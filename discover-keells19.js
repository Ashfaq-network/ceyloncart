import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for the app to initialize
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => {
      try {
        const raw = sessionStorage.getItem('persist:root');
        if (!raw) return false;
        return raw.includes('userSessionID');
      } catch { return false; }
    }).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1000);
  }

  // Get cookies
  const cookies = await context.cookies();
  const authCookie = cookies.find(c => c.name.startsWith('auth_cookie'));
  console.log('Auth cookie name:', authCookie?.name);
  console.log('Auth cookie value:', authCookie?.value?.substring(0, 50));

  // Try search with NO manual session header (using cookies only)
  const result1 = await page.evaluate(async () => {
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '3', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });
    const res = await fetch(`https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    return { status: res.status, body: (await res.text()).substring(0, 1000) };
  });
  console.log('\nWithout session header:', result1.status, result1.body.substring(0, 200));

  // Try with the app's encrypted session ID
  const appSession = await page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('persist:root');
      const parsed = JSON.parse(raw);
      const ud = JSON.parse(parsed.userDetails);
      return ud.userSessionID;
    } catch { return null; }
  });
  console.log('\nApp session:', appSession?.substring(0, 50));

  const result2 = await page.evaluate(async (sid) => {
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '3', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });
    const res = await fetch(`https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'usersessionid': sid },
    });
    return { status: res.status, body: (await res.text()).substring(0, 1000) };
  }, appSession);
  console.log('\nWith encrypted session:', result2.status, result2.body.substring(0, 200));

  // Try our fresh guest login
  const result3 = await page.evaluate(async () => {
    const loginRes = await fetch('https://zebraliveback.keellssuper.com/1.0/Login/GuestLogin', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sid = loginData.result?.userSessionID;
    
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '3', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });
    const res = await fetch(`https://zebraliveback.keellssuper.com/2.0/WebV2/GetItemDetails?${params}`, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'usersessionid': sid },
    });
    return { status: res.status, sessionId: sid, body: (await res.text()).substring(0, 500) };
  });
  console.log('\nFresh guest login:', result3.status, 'session:', result3.sessionId);
  console.log('Body:', result3.body);

  await browser.close();
}

discover().catch(console.error);

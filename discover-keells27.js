import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Intercept the SEARCH request and ALSO capture the previous GuestLogin
  let guestLoginResponse = null;
  page.on('response', async res => {
    if (res.url().includes('GuestLogin')) {
      try {
        const json = await res.json();
        const sid = json.result?.userSessionID;
        if (sid) guestLoginResponse = sid;
      } catch {}
    }
  });

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

  console.log('Captured GuestLogin session:', guestLoginResponse);

  // Now check what the Redux store actually has (the raw persist:root)
  const persistRaw = await page.evaluate(() => {
    return sessionStorage.getItem('persist:root');
  });
  console.log('Persist raw (first 500):', persistRaw?.substring(0, 500));

  // Maybe the session is stored differently - let's look at window properties
  const windowProps = await page.evaluate(() => {
    const props = [];
    // Check for common patterns
    if (typeof window.__STORE__ !== 'undefined') props.push('__STORE__');
    if (typeof window.__REDUX_STORE__ !== 'undefined') props.push('__REDUX_STORE__');
    if (typeof window.store !== 'undefined') props.push('store');
    if (typeof window.__INITIAL_STATE__ !== 'undefined') props.push('__INITIAL_STATE__');
    return props;
  });
  console.log('Window store props:', windowProps);

  // Check if axios interceptors exist
  const axiosInfo = await page.evaluate(() => {
    const info = {};
    // Check for axios on window
    if (typeof window.axios !== 'undefined') {
      info.hasAxios = true;
      info.interceptors = typeof window.axios.interceptors;
    }
    // Check common CDN/import patterns
    info.hasAxiosModule = typeof window.__axios !== 'undefined';
    return info;
  });
  console.log('Axios info:', axiosInfo);

  // Try to use the GuestLogin session directly
  if (guestLoginResponse) {
    const result = await page.evaluate(async (sessionId) => {
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
          headers: { 'Accept': 'application/json', 'usersessionid': sessionId },
        }
      );
      return { status: res.status, body: (await res.text()).substring(0, 500) };
    }, guestLoginResponse);
    
    console.log('Search with GuestLogin session:', JSON.stringify(result, null, 2));
  }

  await browser.close();
}

discover().catch(console.error);

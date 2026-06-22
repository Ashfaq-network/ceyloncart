import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  // Log ALL XHR calls with methods and key info
  page.on('request', req => {
    if (req.url().includes('zebraliveback')) {
      console.log('REQ:', req.method(), req.url().split('?')[0].split('/').slice(-2).join('/'));
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

  await new Promise(r => setTimeout(r, 2000));

  // Now replicate the app's init sequence
  console.log('\n--- Replicating app init sequence ---');
  
  const result = await page.evaluate(async () => {
    const base = 'https://zebraliveback.keellssuper.com';
    
    // Step 1: Guest Login
    const loginRes = await fetch(`${base}/1.0/Login/GuestLogin`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;
    console.log('Step 1 - Login:', sessionId);
    
    // Headers for subsequent calls
    const headers = { 'Accept': 'application/json', 'usersessionid': sessionId };
    
    // Step 2: CheckSession (the app calls this)
    const checkRes = await fetch(`${base}/1.0/Common/CheckSession`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const checkData = await checkRes.json();
    console.log('Step 2 - CheckSession:', checkData.statusCode);
    
    // Step 3: GetInitialDataCollection
    const initRes = await fetch(`${base}/1.0/Web/GetInitialDataCollection?locationCode=SCDR&shippingDetailsId=0`, { headers });
    const initData = await initRes.json();
    console.log('Step 3 - GetInitialDataCollection:', initData.statusCode);
    
    // Step 4: GetSuggestedItems
    const suggestRes = await fetch(`${base}/1.0/Web/GetSuggestedItems?locationCode=SCDR`, { headers });
    const suggestData = await suggestRes.json();
    console.log('Step 4 - GetSuggestedItems:', suggestData.statusCode);
    
    // Step 5: LoadShippingDetails
    const shipRes = await fetch(`${base}/1.0/MyAccount/LoadShippingDetails`, { headers });
    const shipData = await shipRes.json();
    console.log('Step 5 - LoadShippingDetails:', shipData.statusCode);
    
    // NOW try search
    const params = new URLSearchParams({
      pageNo: '1', itemsPerPage: '3', outletCode: 'SCDR',
      departmentId: '', subDepartmentId: '', categoryId: '',
      itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
      isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
      sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
      isShowOutofStockItems: 'true', brandName: '',
    });
    
    const searchRes = await fetch(
      `${base}/2.0/WebV2/GetItemDetails?${params}`,
      { headers }
    );
    const searchText = await searchRes.text();
    console.log('Step 6 - Search:', searchRes.status);
    
    return {
      sessionId,
      searchStatus: searchRes.status,
      searchBody: searchText.substring(0, 500),
    };
  });

  console.log('\nFinal result:');
  console.log('Session:', result.sessionId);
  console.log('Search status:', result.searchStatus);
  console.log('Search body:', result.searchBody);

  await browser.close();
}

discover().catch(console.error);

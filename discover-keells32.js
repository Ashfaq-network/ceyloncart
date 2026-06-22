import { chromium } from 'playwright';

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();

  await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  for (let i = 0; i < 20; i++) {
    const exists = await page.evaluate(() => 
      document.querySelector('input[placeholder="Search on Keells Online"]') !== null
    ).catch(() => false);
    if (exists) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 2000));

  console.log('--- Replicating app init sequence ---');
  
  const result = await page.evaluate(async () => {
    const base = 'https://zebraliveback.keellssuper.com';
    const log = [];
    
    // Step 1: Guest Login
    const loginRes = await fetch(`${base}/1.0/Login/GuestLogin`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: '{}',
    });
    const loginData = await loginRes.json();
    const sessionId = loginData.result?.userSessionID;
    log.push('Login session: ' + sessionId);
    
    const headers = { 'Accept': 'application/json', 'usersessionid': sessionId };
    
    // Step 2: CheckSession (POST, no return body)
    try {
      const r = await fetch(`${base}/1.0/Common/CheckSession`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      });
      log.push('CheckSession: ' + r.status);
    } catch (e) { log.push('CheckSession error: ' + e.message); }
    
    // Step 3: GetInitialDataCollection
    try {
      const r = await fetch(`${base}/1.0/Web/GetInitialDataCollection?locationCode=SCDR&shippingDetailsId=0`, { headers });
      log.push('GetInitialData: ' + r.status);
    } catch (e) { log.push('GetInitialData error: ' + e.message); }
    
    // Step 4: GetSuggestedItems
    try {
      const r = await fetch(`${base}/1.0/Web/GetSuggestedItems?locationCode=SCDR`, { headers });
      log.push('GetSuggestedItems: ' + r.status);
    } catch (e) { log.push('GetSuggestedItems error: ' + e.message); }
    
    // Step 5: LoadShippingDetails
    try {
      const r = await fetch(`${base}/1.0/MyAccount/LoadShippingDetails`, { headers });
      log.push('LoadShipping: ' + r.status);
    } catch (e) { log.push('LoadShipping error: ' + e.message); }
    
    // Step 6: Now search
    try {
      const params = new URLSearchParams({
        pageNo: '1', itemsPerPage: '3', outletCode: 'SCDR',
        departmentId: '', subDepartmentId: '', categoryId: '',
        itemDescription: 'rice', itemPricefrom: '0', itemPriceTo: '5000',
        isFeatured: '0', isPromotionOnly: 'false', promotionCategory: '',
        sortBy: 'default', BrandId: '', storeName: '', subDeaprtmentCode: '',
        isShowOutofStockItems: 'true', brandName: '',
      });
      
      const searchRes = await fetch(`${base}/2.0/WebV2/GetItemDetails?${params}`, { headers });
      const searchText = await searchRes.text();
      log.push('Search: ' + searchRes.status + ' bodyLen=' + searchText.length);
      
      return { sessionId, log, searchBody: searchText.substring(0, 500) };
    } catch (e) {
      log.push('Search error: ' + e.message);
      return { sessionId, log, searchBody: null };
    }
  });

  console.log('\nLog:');
  for (const l of result.log) console.log(' ', l);
  console.log('\nSession:', result.sessionId);
  if (result.searchBody) console.log('Search body:', result.searchBody);

  await browser.close();
}

discover().catch(console.error);

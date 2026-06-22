import { chromium } from 'playwright';

export class KeellsBrowser {
  constructor() {
    this.browser = null;
    this.page = null;
    this.ready = false;
  }

  async init() {
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    this.page = await context.newPage();
    
    await this.page.goto('https://keellssuper.com/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait for the app to initialize
    for (let i = 0; i < 30; i++) {
      const ready = await this.page.evaluate(() => {
        return !!document.querySelector('input[placeholder="Search on Keells Online"]');
      }).catch(() => false);
      if (ready) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    
    this.ready = true;
    console.log('Keells browser ready');
  }

  async search(query) {
    if (!this.ready) await this.init();
    
    // Navigate to search page
    await this.page.evaluate((q) => {
      window.history.pushState({}, '', `/product?cat=4&s=~${q}`);
      // Trigger React Router navigation
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, query);
    
    await new Promise(r => setTimeout(r, 2000));

    // Type in search and press Enter (works with the autocomplete/search)
    const searchInput = await this.page.$('input[placeholder="Search on Keells Online"]');
    if (searchInput) {
      await searchInput.click();
      await new Promise(r => setTimeout(r, 200));
      await searchInput.fill(query);
      await new Promise(r => setTimeout(r, 500));
      await this.page.keyboard.press('Enter');
      
      // Wait for results to render
      await new Promise(r => setTimeout(r, 3000));
    }

    // Extract product data from the DOM
    const products = await this.page.evaluate(() => {
      // Look for the product cards
      const items = [];
      
      // Try various selectors that Keells might use
      const productElements = document.querySelectorAll(
        '[class*="item-card"], [class*="product-card"], [class*="ItemCard"], ' +
        '[class*="ProductCard"], [class*="item_details"], [class*="item-detail"], ' +
        '.item, .product, [class*="col-"] > [class*="item"]'
      );
      
      productElements.forEach(el => {
        const text = el.textContent?.trim();
        if (!text || text.length < 10) return;
        
        // Try to find name, price, image
        const nameEl = el.querySelector('[class*="name"], [class*="Name"], [class*="title"], [class*="Title"], h3, h4, h5, h6, a[href*="product"]');
        const priceEl = el.querySelector('[class*="price"], [class*="Price"], [class*="amount"], [class*="Amount"]');
        const imgEl = el.querySelector('img');
        
        const name = nameEl?.textContent?.trim() || '';
        const priceText = priceEl?.textContent?.trim() || '';
        const imgSrc = imgEl?.src || '';
        
        // Only include if we got at least a name
        if (name && name.length > 3) {
          items.push({
            name,
            priceText,
            image: imgSrc,
            text: text.substring(0, 200),
          });
        }
      });

      return items;
    });

    return products;
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}

// Test
async function test() {
  const kb = new KeellsBrowser();
  await kb.init();
  const results = await kb.search('rice');
  console.log(`Found ${results.length} products:`);
  results.slice(0, 5).forEach((p, i) => {
    console.log(`\n${i + 1}. ${p.name}`);
    console.log(`   Price: ${p.priceText}`);
    console.log(`   Image: ${p.image}`);
    console.log(`   Text: ${p.text.substring(0, 100)}`);
  });
  await kb.close();
}

test().catch(console.error);

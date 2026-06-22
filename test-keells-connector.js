import { KeellsConnector } from './keells-connector.js';

async function test() {
  const k = new KeellsConnector();
  try {
    await k.init();
    console.log('Searching for "rice"...');
    const results = await k.search('rice', { itemsPerPage: 5 });
    console.log(`Found ${results.length} products:\n`);
    results.forEach((p, i) => {
      console.log(`${i + 1}. ${p.name}`);
      console.log(`   Price: ${p.priceFormatted}`);
      console.log(`   Image: ${p.image}`);
      console.log(`   In stock: ${p.inStock}`);
      console.log();
    });
  } catch (e) {
    console.error('Test failed:', e);
  } finally {
    await k.close();
  }
}

test();

import { Actor, log } from 'apify';
import { normalizeStore, fetchStoreProducts } from './shopify.mjs';

await Actor.init();
const inp = (await Actor.getInput()) || {};
const stores = inp.stores || [];
const maxProducts = inp.maxProductsPerStore || 0;
const flattenVariants = inp.flattenVariants === true;
const vendorContains = inp.vendorContains || '';
const productTypeContains = inp.productTypeContains || '';
const delayMs = typeof inp.delayMs === 'number' ? inp.delayMs : 400;

let charged = 0;
for (const raw of stores) {
  const store = normalizeStore(raw);
  if (!store) {
    await Actor.pushData({ input: raw, error: 'unrecognized store URL/domain', scrapedAt: new Date().toISOString() });
    continue;
  }
  log.info(`Fetching ${store.origin} ...`);
  let result;
  try {
    result = await fetchStoreProducts(store, { maxProducts, flattenVariants, vendorContains, productTypeContains, delayMs });
  } catch (e) {
    await Actor.pushData({ input: raw, store: store.origin, error: e.message || String(e), scrapedAt: new Date().toISOString() });
    continue;
  }
  if (!result.products.length) {
    await Actor.pushData({
      input: raw,
      store: store.origin,
      error: result.error || 'no products returned (free, not charged)',
      scrapedAt: new Date().toISOString(),
    });
    continue;
  }
  log.info(`${store.host}: ${result.products.filter((p) => p._chargeOnce).length} products` + (result.truncated ? ' (truncated)' : ''));
  for (const row of result.products) {
    const charge = row._chargeOnce;
    delete row._chargeOnce;
    row.input = raw;
    row.scrapedAt = new Date().toISOString();
    if (result.truncated) row.truncated = true;
    await Actor.pushData(row);
    if (charge) {
      const c = await Actor.charge({ eventName: 'product-result' });
      charged++;
      if (c?.eventChargeLimitReached) {
        log.warning('Max charge reached, stopping.');
        await Actor.exit();
      }
    }
  }
}
log.info(`Done, charged ${charged} products.`);
await Actor.exit();

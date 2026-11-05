/** Public Shopify storefront products.json client (no Admin API, no login). */
const UA = 'shopify-products-multi/1.0 (+https://github.com/mayasterlingfinance-oss/shopify-products-multi; AI-agent-built; polite research crawler)';
const PAGE_LIMIT = 250;
const HARD_CAP = 25000; // Shopify page*limit ceiling

export function normalizeStore(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!u.hostname) return null;
  // strip path to origin; allow myshopify.com or custom domain
  return { origin: u.origin.replace(/\/$/, ''), host: u.hostname.replace(/^www\./, ''), input };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    redirect: 'follow',
  });
  const text = await res.text();
  if (res.status === 404) return { status: 404, data: null };
  if (res.status === 430 || res.status === 429 || res.status === 403) {
    return { status: res.status, data: null, error: `store blocked request (HTTP ${res.status})` };
  }
  if (res.status === 400 && /25000/i.test(text)) {
    return { status: 400, data: null, error: 'shopify 25000 product page*limit ceiling reached' };
  }
  if (!res.ok) return { status: res.status, data: null, error: `HTTP ${res.status}` };
  // Non-JSON HTML often means not a Shopify storefront
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json') && text.trimStart().startsWith('<')) {
    return { status: res.status, data: null, error: 'not a Shopify storefront products.json (got HTML)' };
  }
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: null, error: 'invalid JSON from products.json' };
  }
}

function mapProduct(p, store, flattenVariants) {
  const base = {
    store: store.origin,
    storeHost: store.host,
    productId: p.id,
    title: p.title,
    handle: p.handle,
    url: `${store.origin}/products/${p.handle}`,
    vendor: p.vendor || null,
    productType: p.product_type || null,
    tags: Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? p.tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
    status: p.status || null,
    createdAt: p.created_at || null,
    updatedAt: p.updated_at || null,
    publishedAt: p.published_at || null,
    imageUrl: p.images?.[0]?.src || p.image?.src || null,
    variantsCount: Array.isArray(p.variants) ? p.variants.length : 0,
  };
  if (!flattenVariants) {
    return [{
      ...base,
      variants: (p.variants || []).map((v) => ({
        variantId: v.id,
        title: v.title,
        sku: v.sku || null,
        price: v.price ?? null,
        compareAtPrice: v.compare_at_price ?? null,
        available: v.available ?? null,
        grams: v.grams ?? null,
        barcode: v.barcode || null,
      })),
      minPrice: minPrice(p.variants),
      maxPrice: maxPrice(p.variants),
      anyAvailable: (p.variants || []).some((v) => v.available),
    }];
  }
  // one row per variant (still charged once per product upstream)
  const variants = p.variants || [{ id: null, title: 'Default', sku: null, price: null, available: null }];
  return variants.map((v) => ({
    ...base,
    variantId: v.id,
    variantTitle: v.title,
    sku: v.sku || null,
    price: v.price ?? null,
    compareAtPrice: v.compare_at_price ?? null,
    available: v.available ?? null,
    grams: v.grams ?? null,
    barcode: v.barcode || null,
  }));
}

function minPrice(variants) {
  const nums = (variants || []).map((v) => parseFloat(v.price)).filter((n) => !Number.isNaN(n));
  return nums.length ? Math.min(...nums).toFixed(2) : null;
}
function maxPrice(variants) {
  const nums = (variants || []).map((v) => parseFloat(v.price)).filter((n) => !Number.isNaN(n));
  return nums.length ? Math.max(...nums).toFixed(2) : null;
}

/**
 * Fetch all published products for a store via public /products.json.
 * @returns {{ products: object[], error?: string }}
 */
export async function fetchStoreProducts(store, { maxProducts = 0, flattenVariants = false, vendorContains = '', productTypeContains = '', delayMs = 400 } = {}) {
  const out = [];
  let page = 1;
  const vendorQ = (vendorContains || '').toLowerCase();
  const typeQ = (productTypeContains || '').toLowerCase();

  while (true) {
    if (page * PAGE_LIMIT > HARD_CAP) {
      return { products: out, error: out.length ? undefined : 'shopify 25000 product ceiling', truncated: true };
    }
    const url = `${store.origin}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
    const r = await fetchJson(url);
    if (r.error && !r.data) {
      if (page === 1) return { products: [], error: r.error || `HTTP ${r.status}` };
      break;
    }
    if (r.status === 404 && page === 1) {
      return { products: [], error: 'products.json not found (not a Shopify storefront, or feed disabled)' };
    }
    const products = r.data?.products;
    if (!Array.isArray(products) || products.length === 0) break;

    for (const p of products) {
      if (vendorQ && !(p.vendor || '').toLowerCase().includes(vendorQ)) continue;
      if (typeQ && !(p.product_type || '').toLowerCase().includes(typeQ)) continue;
      const rows = mapProduct(p, store, flattenVariants);
      // We charge per product (not per variant row); attach _chargeOnce on first row
      rows[0]._chargeOnce = true;
      for (let i = 1; i < rows.length; i++) rows[i]._chargeOnce = false;
      out.push(...rows);
      const productCount = out.filter((x) => x._chargeOnce).length;
      if (maxProducts && productCount >= maxProducts) {
        return { products: out.slice(0, indexAfterNProducts(out, maxProducts)), truncated: true };
      }
    }

    if (products.length < PAGE_LIMIT) break;
    page += 1;
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
  }
  return { products: out };
}

function indexAfterNProducts(rows, n) {
  let c = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]._chargeOnce) c++;
    if (c >= n) {
      // include all variant rows of this product
      let j = i + 1;
      while (j < rows.length && !rows[j]._chargeOnce) j++;
      return j;
    }
  }
  return rows.length;
}

# Shopify Products Scraper

Pull **every published product** from one or more **Shopify storefronts** in one run, using the public `/products.json` feed (no login, no Admin API).

- Input: storefront URLs or domains (`https://www.allbirds.com`, `brand.myshopify.com`).
- Output per product: title, handle, URL, vendor, product type, tags, image, variant prices & availability.
- Optional: flatten to one row per variant; filter by vendor / product type; cap products per store.
- Data source: the public storefront catalog JSON Shopify serves for themes. Same data a shopper sees. No personal data.
- Polite defaults: 400ms between pages; stop cleanly on 403/429.

**Pricing:** pay per event, **$0.00005 per product returned** ($0.05 per 1,000 products). Non-Shopify / not-found stores are free.

**Use cases:** competitor catalog & price monitoring, product research, inventory signals (available boolean), multi-store assortment diffs (schedule it).

Transparency: this actor is built and maintained by an autonomous AI agent (Grok Bot) for an entrepreneurship experiment, under account mayasterlingfinance-oss. Issues: open one on the GitHub repo.

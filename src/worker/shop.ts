import type { ShopProduct } from '../shared/types'

/**
 * Product search on Shop MCP (shop.dev): Shopify's catalog across millions of stores. Anonymous
 * search needs no key. Used for the tools a step needs and replacement parts / spare screws.
 * Shop's rules: prices and stock may be shown for at most 10 minutes, so that's the cache here.
 */
const ENDPOINT = 'https://mcp.shop.com/'
const VERSION = '2026-07-28'
const TTL = 10 * 60 * 1000
const cache = new Map<string, { at: number; result: ShopResult }>()

export interface ShopResult {
  products: ShopProduct[]
  /** Shop's "warning" messages, which have to be shown with the results. */
  warnings: string[]
}

/** One Shop MCP tool call; returns its structured result. */
async function callShop(name: string, args: unknown): Promise<any> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': VERSION,
      'mcp-method': 'tools/call',
      'mcp-name': name,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'repair-guide', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
    signal: AbortSignal.timeout(12_000),
  })
  const body = (await res.json().catch(() => null)) as any
  if (!res.ok || body?.error) throw new Error(body?.error?.message ?? `Shop ${name} failed (${res.status})`)
  if (body?.result?.isError) throw new Error(`Shop ${name} failed`)
  return body?.result?.structuredContent ?? {}
}

export async function searchShop(query: string, country: string | null, limit = 4): Promise<ShopResult> {
  const key = `${country ?? ''}|${limit}|${query.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.result

  const doc = await callShop('search_catalog', { catalog: { query, context: country ? { address_country: country } : {}, pagination: { limit } } })
  const result: ShopResult = {
    products: (Array.isArray(doc.products) ? doc.products : []).flatMap((p: any): ShopProduct[] => {
      const v = p?.variants?.[0]
      // Keep the variant URL exactly as returned (Shop's tracking parameters included).
      if (!v?.url || !p?.title) return []
      const image = v.media?.[0]?.url ?? p.media?.[0]?.url ?? null
      const rating = p.rating ?? v.rating
      return [
        {
          title: String(p.title),
          price: v.price && typeof v.price.amount === 'number' ? { amount: v.price.amount, currency: String(v.price.currency) } : null,
          seller: v.seller?.name ? String(v.seller.name) : null,
          url: String(v.url),
          image: typeof image === 'string' ? image : null,
          available: v.availability?.available !== false,
          rating: typeof rating?.value === 'number' ? { value: rating.value, count: rating.count ?? null } : null,
          // What checkout needs: the exact variant ID and the seller's storefront domain.
          variantId: typeof v.id === 'string' ? v.id : null,
          shop: typeof v.seller?.domain === 'string' ? v.seller.domain : null,
        },
      ]
    }),
    warnings: (Array.isArray(doc.messages) ? doc.messages : []).filter((m: any) => m?.type === 'warning' && m.content).map((m: any) => String(m.content)),
  }
  if (cache.size > 300) cache.clear()
  cache.set(key, { at: Date.now(), result })
  return result
}

const checkouts = new Map<string, { at: number; url: string }>()

/**
 * A Shop checkout for one item, created when the buyer taps Buy. Returns Shop's "Review and pay"
 * page (continue_url, passed on unchanged), where they add contact, address and payment.
 * Creates no order. The same item within 10 minutes reuses its checkout instead of making another.
 */
export async function createCheckout(shop: string, variantId: string, country: string | null): Promise<string> {
  const key = `${shop}|${variantId}|${country ?? ''}`
  const hit = checkouts.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.url
  const doc = await callShop('create_checkout', {
    shop,
    checkout: { line_items: [{ item: { id: variantId }, quantity: 1 }], ...(country ? { context: { address_country: country } } : {}) },
    meta: { 'idempotency-key': crypto.randomUUID() },
  })
  const url = typeof doc.continue_url === 'string' ? doc.continue_url : null
  if (!url || !url.startsWith('https://')) throw new Error('Shop returned no checkout link')
  if (checkouts.size > 300) checkouts.clear()
  checkouts.set(key, { at: Date.now(), url })
  return url
}

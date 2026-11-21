import { Hono } from 'hono'
import { createCheckout, searchShop } from '../shop'

const shop = new Hono<{ Bindings: Env }>()

// Products for a tool, a spare fastener or a replacement part. ?q=search words
shop.get('/shop', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 120)
  if (q.length < 2) return c.json({ error: 'q is required' }, 400)
  const country = (c.req.raw.cf?.country as string | undefined) ?? null
  const result = await searchShop(q, country)
  c.header('cache-control', 'private, max-age=600')
  return c.json(result)
})

// Buy one product: a Shop checkout, returned as its "Review and pay" link. Body: { shop, variantId }
shop.post('/shop/checkout', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { shop?: unknown; variantId?: unknown } | null
  const store = typeof body?.shop === 'string' ? body.shop.toLowerCase() : ''
  const variantId = typeof body?.variantId === 'string' ? body.variantId : ''
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(store) || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId))
    return c.json({ error: 'shop and variantId are required' }, 400)
  const country = (c.req.raw.cf?.country as string | undefined) ?? null
  try {
    return c.json({ url: await createCheckout(store, variantId, country) })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
})

export default shop

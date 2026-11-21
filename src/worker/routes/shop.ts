import { Hono } from 'hono'
import { searchShop } from '../shop'

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

export default shop

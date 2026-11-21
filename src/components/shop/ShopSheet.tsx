import { ExternalLink, ShoppingBag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { searchShop, type ShopResult } from '../../api'
import { money } from './money'
import { closeShop, useShopQuery } from './shopStore'
import './shop.css'

/** Shopify CDN images resize by query param; a small one is plenty for a row. */
const thumb = (url: string) => (url.includes('cdn.shopify.com') ? `${url}${url.includes('?') ? '&' : '?'}width=160` : url)

/** Products from Shop for a tool or a replacement part. Opened with openShop(). */
export default function ShopSheet() {
  const q = useShopQuery()
  const [state, setState] = useState<{ key: string; result?: ShopResult; error?: string } | null>(null)

  useEffect(() => {
    if (!q) return
    const ctrl = new AbortController()
    searchShop(q.query, ctrl.signal)
      .then((result) => setState({ key: q.query, result }))
      .catch((err) => !ctrl.signal.aborted && setState({ key: q.query, error: (err as Error).message }))
    return () => ctrl.abort()
  }, [q])

  if (!q) return null
  const ready = state?.key === q.query ? state : null
  return (
    <div className="sheet-backdrop" onClick={closeShop}>
      <div className="sheet card shop-sheet" role="dialog" aria-label={q.title} onClick={(e) => e.stopPropagation()}>
        <h2 className="icon-text">
          <ShoppingBag aria-hidden /> {q.title}
        </h2>
        {!ready && <p className="muted">Searching…</p>}
        {ready?.error && <p className="error">Couldn't load products.</p>}
        {ready?.result?.warnings.map((w) => (
          <p key={w} className="shop-warning">
            {w}
          </p>
        ))}
        {ready?.result && ready.result.products.length === 0 && <p className="muted">No matches.</p>}
        <ul className="shop-list">
          {ready?.result?.products.map((p) => (
            <li key={p.url}>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.image ? <img src={thumb(p.image)} alt="" loading="lazy" /> : <span className="shop-noimg" />}
                <span className="shop-info">
                  <strong>{p.title}</strong>
                  <span className="muted small">
                    {[p.seller, p.rating && `★ ${p.rating.value.toFixed(1)}`, !p.available && 'Out of stock'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shop-price">
                  {p.price && money(p.price)}
                  <ExternalLink aria-hidden />
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="muted small">From Shop</p>
        <button className="btn ghost" onClick={closeShop}>
          Close
        </button>
      </div>
    </div>
  )
}

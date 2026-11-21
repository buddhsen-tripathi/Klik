import { ShoppingBag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { searchShop, type ShopResult } from '../../api'
import ShopItem from './ShopItem'
import { closeShop, useShopQuery } from './shopStore'
import './shop.css'
import { useT } from '../../i18n/useT'

/** Products from Shop for a tool or a replacement part. Opened with openShop(). */
export default function ShopSheet() {
  const t = useT()
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
        {!ready && <p className="muted">{t('searching')}</p>}
        {ready?.error && <p className="error">{t('loadFailed')}</p>}
        {ready?.result?.warnings.map((w) => (
          <p key={w} className="shop-warning">
            {w}
          </p>
        ))}
        {ready?.result && ready.result.products.length === 0 && <p className="muted">{t('noMatches')}</p>}
        <ul className="shop-list">
          {ready?.result?.products.map((p) => (
            <li key={p.url}>
              <ShopItem p={p} />
            </li>
          ))}
        </ul>
        <p className="muted small">{t('fromShop')}</p>
        <button className="btn ghost" onClick={closeShop}>
          {t('close')}
        </button>
      </div>
    </div>
  )
}

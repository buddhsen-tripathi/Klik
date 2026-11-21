import { ExternalLink, LoaderCircle, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { startCheckout } from '../../api'
import { useT } from '../../i18n/useT'
import type { ShopProduct } from '../../shared/types'
import { money } from './money'

/** Shopify CDN images resize by query param; a small one is plenty for a row. */
const thumb = (url: string) => (url.includes('cdn.shopify.com') ? `${url}${url.includes('?') ? '&' : '?'}width=160` : url)

/** One product. Tapping it goes straight to Shop's checkout; without a variant it opens the product page. */
export default function ShopItem({ p }: { p: ShopProduct }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const canBuy = Boolean(p.shop && p.variantId && p.available)

  const buy = async (e: React.MouseEvent) => {
    if (!canBuy || busy) return
    e.preventDefault()
    // Open the tab inside the tap (popup blockers), then point it at checkout when the link arrives.
    const tab = window.open('', '_blank')
    setBusy(true)
    try {
      const { url } = await startCheckout(p.shop!, p.variantId!)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch {
      // Checkout failed: the product page still lets them buy.
      if (tab) tab.location.href = p.url
      else window.location.href = p.url
    } finally {
      setBusy(false)
    }
  }

  const info = [p.seller, p.rating && `★ ${p.rating.value.toFixed(1)}`, !p.available && 'Out of stock'].filter(Boolean).join(' · ')
  return (
    <a href={p.url} target="_blank" rel="noreferrer" onClick={buy} aria-busy={busy}>
      {p.image ? <img src={thumb(p.image)} alt="" loading="lazy" /> : <span className="shop-noimg" />}
      <span className="shop-info">
        <strong>{p.title}</strong>
        <span className="muted small">{busy ? t('openingCheckout') : info}</span>
      </span>
      <span className="shop-price">
        {p.price && money(p.price)}
        {canBuy ? (
          <span className="shop-buy">
            {busy ? <LoaderCircle className="spin" aria-hidden /> : <ShoppingCart aria-hidden />} {t('buy')}
          </span>
        ) : (
          <ExternalLink aria-hidden />
        )}
      </span>
    </a>
  )
}

import { useSyncExternalStore } from 'react'

/** What the Shop sheet is showing: a heading and the search words sent to Shop. */
export interface ShopQuery {
  title: string
  query: string
}

let current: ShopQuery | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Open the product sheet from anywhere (tool chips, part details, the voice helper). */
export function openShop(q: ShopQuery) {
  current = q
  emit()
}
export function closeShop() {
  current = null
  emit()
}
export const useShopQuery = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )

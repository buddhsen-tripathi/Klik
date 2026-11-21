/** Shop prices are integers in the currency's minor units (549 USD = $5.49, 549 JPY = ¥549). */
export function money({ amount, currency }: { amount: number; currency: string }) {
  const f = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  return f.format(amount / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2))
}

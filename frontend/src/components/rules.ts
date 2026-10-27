// Pure helpers shared by components (kept apart so component files only export components).
import type { ReceivingStatus } from '../api/types'
import type { ProductOption } from './ProductPicker'

export const MAX_QUANTITY = 1_000_000

/** BR-05 / BR-07: a whole number from 1 to 1,000,000; null when valid. */
export const quantityError = (value: number | string): string | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY
    ? null
    : 'Whole number from 1 to 1,000,000'

export interface Line {
  key: string
  product: ProductOption | null
  expectedQuantity: number | string
}

export const productError = (line: Line) => (line.product ? null : 'Choose a product')

/** True when every line has a product and a valid expected quantity. */
export const linesValid = (lines: Line[]) =>
  lines.every((l) => !productError(l) && !quantityError(l.expectedQuantity))

/** "IN_PROGRESS" → "In progress". */
export const statusLabel = (s: ReceivingStatus) =>
  s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')

const pad = (n: number) => String(n).padStart(2, '0')

/** An API timestamp (UTC) as `YYYY-MM-DD HH:mm` in the browser's time zone. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local midnight of a `YYYY-MM-DD` day, `addDays` later, as a UTC ISO timestamp. */
function localDayStart(day: string, addDays = 0): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d + addDays).toISOString()
}

export interface TransactionFilters {
  productId?: string
  /** Local calendar days, both inclusive. */
  from?: string
  to?: string
  page: number
}

/** FR-41 filters → API query; the API's `to` is exclusive, so it gets the day after the last day. */
// A hand-edited URL may carry anything; only a real day becomes a bound.
const isDay = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export const transactionParams = ({ productId, from, to, page }: TransactionFilters) => ({
  ...(productId && { productId }),
  ...(isDay(from) && { from: localDayStart(from) }),
  ...(isDay(to) && { to: localDayStart(to, 1) }),
  page,
})

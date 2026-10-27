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

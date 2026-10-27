import { NumberInput, type NumberInputProps } from '@mantine/core'
import { MAX_QUANTITY } from './rules'

/** Accepts digits only, so decimals and negatives cannot be typed; range errors are shown, not clamped. */
export function QuantityInput(props: NumberInputProps) {
  return (
    <NumberInput
      allowDecimal={false}
      allowNegative={false}
      min={1}
      max={MAX_QUANTITY}
      clampBehavior="none"
      hideControls
      {...props}
    />
  )
}

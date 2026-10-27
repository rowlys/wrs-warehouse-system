import { Button, Group } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../api/client'
import { recordReceipt } from '../api/endpoints'
import type { ReceivingItem } from '../api/types'
import { ErrorAlert } from './ErrorAlert'
import { QuantityInput } from './QuantityInput'
import { quantityError } from './rules'

const newKey = () => crypto.randomUUID()

/**
 * FR-30, AC-04.9: receive a quantity for one line. Spec §6 frontend side: one Idempotency-Key per
 * submission, reused on retries, renewed after a success or when the quantity changes.
 */
export function ReceiveForm({ documentId, item }: { documentId: string; item: ReceivingItem }) {
  const queryClient = useQueryClient()
  const [qty, setQty] = useState<number | string>('')
  const [key, setKey] = useState(newKey)

  const receive = useMutation({
    mutationFn: (quantity: number) => recordReceipt(documentId, item.id, quantity, key),
    onSuccess: async (result) => {
      setQty('')
      setKey(newKey())
      notifications.show({
        color: 'green',
        message: `Received ${result.receipt.quantity} ${item.product.unitOfMeasure} of ${item.product.sku}`,
      })
      await Promise.all(
        [['document', documentId], ['documents'], ['inventory'], ['transactions']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
    },
    onError: async (err) => {
      // The line changed under us (another receipt); refresh it so the remaining quantity is current.
      if (err instanceof ApiError && err.code === 'QUANTITY_EXCEEDS_REMAINING') {
        await queryClient.invalidateQueries({ queryKey: ['document', documentId] })
      }
    },
  })

  const err = receive.error
  const remainingFromApi =
    err instanceof ApiError && err.code === 'QUANTITY_EXCEEDS_REMAINING' ? Number(err.details?.remainingQuantity) : null
  const inputError =
    remainingFromApi !== null
      ? `Only ${remainingFromApi} remaining`
      : typeof qty === 'number' && qty > item.remainingQuantity
        ? `Only ${item.remainingQuantity} remaining`
        : qty === ''
          ? null
          : quantityError(qty)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        receive.mutate(Number(qty))
      }}
    >
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <QuantityInput
          aria-label={`Quantity to receive of ${item.product.sku}`}
          placeholder={`1–${item.remainingQuantity}`}
          w={120}
          max={item.remainingQuantity}
          value={qty}
          onChange={(v) => {
            setQty(v)
            setKey(newKey())
            receive.reset()
          }}
          error={inputError}
        />
        <Button type="submit" loading={receive.isPending} disabled={qty === '' || !!inputError}>
          Receive
        </Button>
      </Group>
      {err && remainingFromApi === null && <ErrorAlert error={err} />}
    </form>
  )
}

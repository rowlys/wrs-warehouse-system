import { ActionIcon, Button, Group, Stack, Text } from '@mantine/core'
import { ProductPicker } from './ProductPicker'
import { QuantityInput } from './QuantityInput'
import { productError, quantityError, type Line } from './rules'

interface Props {
  lines: Line[]
  onChange: (lines: Line[]) => void
  /** Also flag empty fields, e.g. after a submit attempt. Typed values are checked at once. */
  showErrors?: boolean
}

/** Draft lines of a new receiving document (FR-21): product + expected quantity. */
export function LineEditor({ lines, onChange, showErrors = false }: Props) {
  const update = (key: string, patch: Partial<Line>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <Stack gap="xs">
      {lines.length === 0 && <Text c="dimmed">No lines yet.</Text>}
      {lines.map((line) => (
        <Group key={line.key} align="flex-start" wrap="nowrap">
          <div style={{ flex: 1 }}>
            <ProductPicker
              value={line.product}
              onChange={(product) => update(line.key, { product })}
              takenIds={lines.filter((l) => l.key !== line.key && l.product).map((l) => l.product!.id)}
              error={showErrors ? productError(line) : null}
            />
          </div>
          <QuantityInput
            aria-label="Expected quantity"
            placeholder="Expected qty"
            w={140}
            value={line.expectedQuantity}
            onChange={(expectedQuantity) => update(line.key, { expectedQuantity })}
            error={showErrors || line.expectedQuantity !== '' ? quantityError(line.expectedQuantity) : null}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            size="lg"
            aria-label="Remove line"
            onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
          >
            ✕
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button
          variant="light"
          onClick={() =>
            onChange([...lines, { key: crypto.randomUUID(), product: null, expectedQuantity: '' }])
          }
        >
          Add line
        </Button>
      </Group>
    </Stack>
  )
}

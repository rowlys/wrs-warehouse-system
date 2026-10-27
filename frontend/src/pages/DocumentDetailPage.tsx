import { Alert, Button, Center, Group, Loader, Modal, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { addItem, changeStatus, getDocument, removeItem, updateItem } from '../api/endpoints'
import type { ReceivingDocumentDetail, ReceivingItem, UserRef } from '../api/types'
import { documentActions } from '../auth/document-state'
import { useCurrentUser } from '../auth/useAuth'
import { ErrorAlert } from '../components/ErrorAlert'
import { ProductPicker, type ProductOption } from '../components/ProductPicker'
import { QuantityInput } from '../components/QuantityInput'
import { ReasonDialog } from '../components/ReasonDialog'
import { ReceiveForm } from '../components/ReceiveForm'
import { quantityError } from '../components/rules'
import { StatusBadge } from '../components/StatusBadge'

const when = (at: string) => new Date(at).toLocaleString()

function Event({ label, at, by, reason }: { label: string; at: string | null; by: UserRef | null; reason?: string | null }) {
  if (!at) return null
  return (
    <Text size="sm">
      {`${label} ${when(at)} by ${by?.fullName ?? '—'}`}
      {reason && ` — “${reason}”`}
    </Text>
  )
}

type Dialog = 'complete' | 'cancel' | null

/** FR-23, FR-34: document header, lines and receipts, with the actions role and status allow. */
export function DocumentDetailPage() {
  const { id } = useParams() as { id: string }
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const document = useQuery({ queryKey: ['document', id], queryFn: () => getDocument(id) })

  // Every action resolves to the updated document, except removing a line (204).
  const action = useMutation({
    mutationFn: (run: () => Promise<ReceivingDocumentDetail | void>) => run(),
    onSuccess: async (detail) => {
      if (detail) queryClient.setQueryData(['document', id], detail)
      else await queryClient.invalidateQueries({ queryKey: ['document', id] })
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
      setDialog(null)
    },
  })
  const closeDialog = () => {
    setDialog(null)
    action.reset()
  }

  if (document.isPending) {
    return (
      <Center>
        <Loader />
      </Center>
    )
  }
  if (document.isError) return <ErrorAlert error={document.error} />

  const doc = document.data
  const can = documentActions(user?.role, doc)
  const busy = action.isPending

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="sm">
            <Title order={2}>{doc.documentNumber}</Title>
            <StatusBadge status={doc.status} />
          </Group>
          <Text>{doc.supplierName}</Text>
        </div>
        <Group>
          {can.open && (
            <Button disabled={busy} onClick={() => action.mutate(() => changeStatus(id, 'open'))}>
              Open for receiving
            </Button>
          )}
          {can.complete && (
            <Button color="green" disabled={busy} onClick={() => setDialog('complete')}>
              Complete
            </Button>
          )}
          {can.cancel && (
            <Button color="red" variant="light" disabled={busy} onClick={() => setDialog('cancel')}>
              Cancel document
            </Button>
          )}
        </Group>
      </Group>

      {!dialog && <ErrorAlert error={action.error} />}
      {doc.status === 'IN_PROGRESS' && doc.allItemsReceived && (
        <Alert color="green">All items received — ready to complete</Alert>
      )}

      <Paper withBorder p="sm">
        <Stack gap={4}>
          <Text size="sm">Reference: {doc.referenceNumber ?? '—'}</Text>
          <Text size="sm">Expected date: {doc.expectedDate ?? '—'}</Text>
          {doc.notes && <Text size="sm">Notes: {doc.notes}</Text>}
          <Event label="Created" at={doc.createdAt} by={doc.createdBy} />
          <Event label="Opened" at={doc.openedAt} by={doc.openedBy} />
          <Event label="Completed" at={doc.completedAt} by={doc.completedBy} />
          <Event label="Cancelled" at={doc.cancelledAt} by={doc.cancelledBy} reason={doc.cancelReason} />
        </Stack>
      </Paper>

      <Title order={4}>Lines</Title>
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Unit</Table.Th>
            <Table.Th ta="right">Expected</Table.Th>
            <Table.Th ta="right">Received</Table.Th>
            <Table.Th ta="right">Remaining</Table.Th>
            <Table.Th>Fully received</Table.Th>
            {(can.editLines || can.receive) && <Table.Th />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {doc.items.map((item) => (
            <Table.Tr key={item.id}>
              <Table.Td>{item.product.sku}</Table.Td>
              <Table.Td>{item.product.name}</Table.Td>
              <Table.Td>{item.product.unitOfMeasure}</Table.Td>
              <Table.Td ta="right">
                {can.editLines ? (
                  <ExpectedEditor
                    item={item}
                    busy={busy}
                    onSave={(qty) => action.mutate(() => updateItem(id, item.id, qty))}
                  />
                ) : (
                  item.expectedQuantity
                )}
              </Table.Td>
              <Table.Td ta="right">{item.receivedQuantity}</Table.Td>
              <Table.Td ta="right">{item.remainingQuantity}</Table.Td>
              <Table.Td>{item.isFullyReceived ? '✓' : '—'}</Table.Td>
              {can.receive && <Table.Td>{!item.isFullyReceived && <ReceiveForm documentId={id} item={item} />}</Table.Td>}
              {can.editLines && (
                <Table.Td>
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => action.mutate(() => removeItem(id, item.id))}
                  >
                    Remove
                  </Button>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {doc.items.length === 0 && <Text c="dimmed">No lines yet.</Text>}
      {can.editLines && (
        <AddLine
          takenIds={doc.items.map((i) => i.product.id)}
          busy={busy}
          onAdd={(product, qty, done) =>
            action.mutate(() => addItem(id, product.id, qty), { onSuccess: done })
          }
        />
      )}

      <Title order={4}>Receipts</Title>
      {doc.receipts.length === 0 ? (
        <Text c="dimmed">No receipts yet.</Text>
      ) : (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Received at</Table.Th>
              <Table.Th>SKU</Table.Th>
              <Table.Th ta="right">Quantity</Table.Th>
              <Table.Th>By</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {doc.receipts.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{when(r.receivedAt)}</Table.Td>
                <Table.Td>{r.productSku}</Table.Td>
                <Table.Td ta="right">{r.quantity}</Table.Td>
                <Table.Td>{r.receivedBy.fullName}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={dialog === 'complete'} onClose={closeDialog} title={`Complete ${doc.documentNumber}?`}>
        <Stack>
          <Text size="sm">Every line is fully received. Completing is final.</Text>
          <ErrorAlert error={action.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDialog}>
              Back
            </Button>
            <Button color="green" loading={busy} onClick={() => action.mutate(() => changeStatus(id, 'complete'))}>
              Complete document
            </Button>
          </Group>
        </Stack>
      </Modal>
      {dialog === 'cancel' && (
        <ReasonDialog
          title={`Cancel ${doc.documentNumber}`}
          confirmLabel="Cancel document"
          loading={busy}
          error={action.error}
          onClose={closeDialog}
          onConfirm={(reason) => action.mutate(() => changeStatus(id, 'cancel', reason))}
        />
      )}
    </Stack>
  )
}

/** FR-25: change a DRAFT line's expected quantity. */
function ExpectedEditor({ item, busy, onSave }: { item: ReceivingItem; busy: boolean; onSave: (qty: number) => void }) {
  const [value, setValue] = useState<number | string>(item.expectedQuantity)
  const changed = value !== item.expectedQuantity
  const error = quantityError(value)
  return (
    <Group gap="xs" justify="flex-end" wrap="nowrap">
      <QuantityInput aria-label={`Expected quantity of ${item.product.sku}`} w={110} value={value} onChange={setValue} error={error} />
      {changed && (
        <Button size="xs" disabled={busy || !!error} onClick={() => onSave(Number(value))}>
          Save
        </Button>
      )}
    </Group>
  )
}

/** FR-24: add a product line to a DRAFT. */
function AddLine({
  takenIds,
  busy,
  onAdd,
}: {
  takenIds: string[]
  busy: boolean
  onAdd: (product: ProductOption, qty: number, done: () => void) => void
}) {
  const [product, setProduct] = useState<ProductOption | null>(null)
  const [qty, setQty] = useState<number | string>('')
  const qtyError = qty === '' ? null : quantityError(qty)
  return (
    <Group align="flex-start">
      <div style={{ flex: 1 }}>
        <ProductPicker value={product} onChange={setProduct} takenIds={takenIds} />
      </div>
      <QuantityInput aria-label="Expected quantity" placeholder="Expected qty" w={140} value={qty} onChange={setQty} error={qtyError} />
      <Button
        disabled={busy || !product || qty === '' || !!qtyError}
        onClick={() =>
          onAdd(product!, Number(qty), () => {
            setProduct(null)
            setQty('')
          })
        }
      >
        Add line
      </Button>
    </Group>
  )
}

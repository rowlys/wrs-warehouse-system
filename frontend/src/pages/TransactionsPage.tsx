import { Badge, Group, Pagination, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { getProduct, listTransactions } from '../api/endpoints'
import { ErrorAlert } from '../components/ErrorAlert'
import { ProductPicker } from '../components/ProductPicker'
import { formatDateTime, transactionParams } from '../components/rules'

/** FR-41: the stock ledger, newest first. Filters live in the URL so inventory rows can link here. */
export function TransactionsPage() {
  const [params, setParams] = useSearchParams()
  const productId = params.get('productId') ?? undefined
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Number(params.get('page')) || 1

  // Any filter change goes back to page 1.
  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }

  // The picker needs the product's SKU and name when only its id came in the URL.
  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => getProduct(productId!),
    enabled: !!productId,
  })
  const transactions = useQuery({
    queryKey: ['transactions', { productId, from, to, page }],
    queryFn: () => listTransactions(transactionParams({ productId, from, to, page })),
    placeholderData: keepPreviousData,
  })

  return (
    <Stack>
      <Title order={2}>Transactions</Title>
      <Group align="flex-end" grow>
        <ProductPicker
          value={productId && product.data ? product.data : null}
          onChange={(p) => setFilter('productId', p?.id)}
          clearable
        />
        <TextInput label="From" type="date" value={from} onChange={(e) => setFilter('from', e.currentTarget.value)} />
        <TextInput label="To" type="date" value={to} onChange={(e) => setFilter('to', e.currentTarget.value)} />
      </Group>
      <ErrorAlert error={transactions.error ?? product.error} />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date / time</Table.Th>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th ta="right">Change</Table.Th>
            <Table.Th ta="right">Balance after</Table.Th>
            <Table.Th>Document</Table.Th>
            <Table.Th>User</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {transactions.data?.data.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>{formatDateTime(t.createdAt)}</Table.Td>
              <Table.Td>{t.product.sku}</Table.Td>
              <Table.Td>{t.product.name}</Table.Td>
              <Table.Td>
                <Badge variant="light" color={t.type === 'RECEIPT' ? 'green' : 'red'}>
                  {t.type === 'RECEIPT' ? 'Receipt' : 'Reversal'}
                </Badge>
              </Table.Td>
              <Table.Td ta="right">{t.quantityChange > 0 ? `+${t.quantityChange}` : t.quantityChange}</Table.Td>
              <Table.Td ta="right">{t.balanceAfter}</Table.Td>
              <Table.Td>
                {t.receivingDocument ? (
                  <Link to={`/receiving/${t.receivingDocument.id}`}>{t.receivingDocument.documentNumber}</Link>
                ) : (
                  '—'
                )}
              </Table.Td>
              <Table.Td>{t.createdBy.fullName}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {transactions.data?.data.length === 0 && <Text c="dimmed">No transactions found.</Text>}
      {(transactions.data?.meta.totalPages ?? 0) > 1 && (
        <Pagination
          value={page}
          onChange={(p) => setFilter('page', String(p))}
          total={transactions.data!.meta.totalPages}
        />
      )}
    </Stack>
  )
}

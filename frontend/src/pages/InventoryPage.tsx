import { Pagination, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { listInventory } from '../api/endpoints'
import { ErrorAlert } from '../components/ErrorAlert'
import { formatDateTime } from '../components/rules'

/** FR-40: on-hand per product, sorted by SKU; each SKU links to its transactions. */
export function InventoryPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)

  const inventory = useQuery({
    queryKey: ['inventory', { search: debouncedSearch, page }],
    queryFn: () => listInventory({ search: debouncedSearch, page }),
    placeholderData: keepPreviousData,
  })

  return (
    <Stack>
      <Title order={2}>Inventory</Title>
      <TextInput
        placeholder="Search SKU or name"
        aria-label="Search inventory"
        maxLength={100}
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value)
          setPage(1)
        }}
      />
      <ErrorAlert error={inventory.error} />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Unit</Table.Th>
            <Table.Th ta="right">On hand</Table.Th>
            <Table.Th>Updated</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {inventory.data?.data.map((b) => (
            <Table.Tr key={b.productId}>
              <Table.Td>
                <Link to={`/inventory/transactions?productId=${b.productId}`}>{b.sku}</Link>
              </Table.Td>
              <Table.Td>{b.name}</Table.Td>
              <Table.Td>{b.unitOfMeasure}</Table.Td>
              <Table.Td ta="right">{b.quantityOnHand}</Table.Td>
              <Table.Td>{formatDateTime(b.updatedAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {inventory.data?.data.length === 0 && <Text c="dimmed">No products found.</Text>}
      {(inventory.data?.meta.totalPages ?? 0) > 1 && (
        <Pagination value={page} onChange={setPage} total={inventory.data!.meta.totalPages} />
      )}
    </Stack>
  )
}

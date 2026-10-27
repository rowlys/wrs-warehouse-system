import { Button, Group, Pagination, Progress, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { listDocuments } from '../api/endpoints'
import { RECEIVING_STATUSES, type ReceivingStatus } from '../api/types'
import { can } from '../auth/permissions'
import { useCurrentUser } from '../auth/useAuth'
import { ErrorAlert } from '../components/ErrorAlert'
import { statusLabel } from '../components/rules'
import { StatusBadge } from '../components/StatusBadge'

const STATUS_OPTIONS = RECEIVING_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))

/** FR-20: newest first, filter by status, search number / supplier / reference. */
export function DocumentsPage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const [status, setStatus] = useState<ReceivingStatus | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)

  const docs = useQuery({
    queryKey: ['documents', { status, search: debouncedSearch, page }],
    queryFn: () => listDocuments({ status: status ?? undefined, search: debouncedSearch, page }),
    placeholderData: keepPreviousData,
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Receiving documents</Title>
        {can(user?.role, 'CREATE_DOCUMENT') && (
          <Button component={Link} to="/receiving/new">
            New document
          </Button>
        )}
      </Group>
      <Group grow>
        <TextInput
          placeholder="Search number, supplier or reference"
          aria-label="Search documents"
          maxLength={100}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value)
            setPage(1)
          }}
        />
        <Select
          aria-label="Status"
          placeholder="All statuses"
          clearable
          data={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v as ReceivingStatus | null)
            setPage(1)
          }}
        />
      </Group>
      <ErrorAlert error={docs.error} />
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Number</Table.Th>
            <Table.Th>Supplier</Table.Th>
            <Table.Th>Reference</Table.Th>
            <Table.Th>Expected</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Received / expected</Table.Th>
            <Table.Th>Created</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {docs.data?.data.map((d) => (
            <Table.Tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/receiving/${d.id}`)}>
              <Table.Td>
                <Link to={`/receiving/${d.id}`}>{d.documentNumber}</Link>
              </Table.Td>
              <Table.Td>{d.supplierName}</Table.Td>
              <Table.Td>{d.referenceNumber ?? '—'}</Table.Td>
              <Table.Td>{d.expectedDate ?? '—'}</Table.Td>
              <Table.Td>
                <StatusBadge status={d.status} />
              </Table.Td>
              <Table.Td miw={140}>
                <Text size="sm">
                  {d.totalReceivedQuantity} / {d.totalExpectedQuantity}
                </Text>
                <Progress
                  size="sm"
                  value={d.totalExpectedQuantity ? (100 * d.totalReceivedQuantity) / d.totalExpectedQuantity : 0}
                />
              </Table.Td>
              <Table.Td>{new Date(d.createdAt).toLocaleDateString()}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {docs.data?.data.length === 0 && <Text c="dimmed">No receiving documents found.</Text>}
      {(docs.data?.meta.totalPages ?? 0) > 1 && (
        <Pagination value={page} onChange={setPage} total={docs.data!.meta.totalPages} />
      )}
    </Stack>
  )
}

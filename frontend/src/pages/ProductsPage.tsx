import { Button, Group, Modal, Pagination, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedValue, useDisclosure } from '@mantine/hooks'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../api/client'
import { createProduct, listProducts } from '../api/endpoints'
import { can } from '../auth/permissions'
import { useCurrentUser } from '../auth/useAuth'
import { ErrorAlert } from '../components/ErrorAlert'

export function ProductsPage() {
  const user = useCurrentUser()
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [opened, { open, close }] = useDisclosure(false)

  const products = useQuery({
    queryKey: ['products', { search: debouncedSearch, page }],
    queryFn: () => listProducts({ search: debouncedSearch, page }),
    placeholderData: keepPreviousData,
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Products</Title>
        {can(user?.role, 'CREATE_PRODUCT') && <Button onClick={open}>New product</Button>}
      </Group>
      <TextInput
        placeholder="Search SKU or name"
        aria-label="Search products"
        maxLength={100}
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value)
          setPage(1)
        }}
      />
      <ErrorAlert error={products.error} />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Unit</Table.Th>
            <Table.Th ta="right">On hand</Table.Th>
            <Table.Th>Created</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {products.data?.data.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.sku}</Table.Td>
              <Table.Td>{p.name}</Table.Td>
              <Table.Td>{p.unitOfMeasure}</Table.Td>
              <Table.Td ta="right">{p.quantityOnHand}</Table.Td>
              <Table.Td>{new Date(p.createdAt).toLocaleDateString()}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {products.data?.data.length === 0 && <Text c="dimmed">No products found.</Text>}
      {(products.data?.meta.totalPages ?? 0) > 1 && (
        <Pagination value={page} onChange={setPage} total={products.data!.meta.totalPages} />
      )}
      <Modal opened={opened} onClose={close} title="New product">
        <CreateProductForm onDone={close} />
      </Modal>
    </Stack>
  )
}

function CreateProductForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const form = useForm({
    initialValues: { sku: '', name: '', unitOfMeasure: '', description: '' },
  })
  const create = useMutation({
    mutationFn: createProduct,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      onDone()
    },
    // Field errors go under their inputs; anything else (e.g. 409 DUPLICATE_SKU) above the form.
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') form.setErrors(err.fieldErrors)
    },
  })
  const formError =
    create.error instanceof ApiError && create.error.code === 'VALIDATION_ERROR' ? null : create.error

  return (
    <form
      onSubmit={form.onSubmit((v) =>
        create.mutate({ ...v, description: v.description.trim() || null }),
      )}
    >
      <Stack>
        <ErrorAlert error={formError} />
        <TextInput label="SKU" required maxLength={50} {...form.getInputProps('sku')} />
        <TextInput label="Name" required maxLength={200} {...form.getInputProps('name')} />
        <TextInput label="Unit of measure" required maxLength={20} {...form.getInputProps('unitOfMeasure')} />
        <Textarea label="Description" maxLength={1000} {...form.getInputProps('description')} />
        <Button type="submit" loading={create.isPending}>
          Create
        </Button>
      </Stack>
    </form>
  )
}

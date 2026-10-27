import { Button, Group, Stack, Textarea, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { createDocument } from '../api/endpoints'
import { can } from '../auth/permissions'
import { useCurrentUser } from '../auth/useAuth'
import { ErrorAlert } from '../components/ErrorAlert'
import { LineEditor } from '../components/LineEditor'
import { linesValid, type Line } from '../components/rules'

/** FR-21: a supervisor creates a DRAFT with header fields and optional lines. */
export function DocumentCreatePage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [lines, setLines] = useState<Line[]>([])
  const [submitted, setSubmitted] = useState(false)
  const form = useForm({
    initialValues: { supplierName: '', referenceNumber: '', expectedDate: '', notes: '' },
    validate: { supplierName: (v) => (v.trim() ? null : 'Supplier name is required') },
  })

  const create = useMutation({
    mutationFn: createDocument,
    onSuccess: async (doc) => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
      navigate(`/receiving/${doc.id}`)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') form.setErrors(err.fieldErrors)
    },
  })
  const formError =
    create.error instanceof ApiError && create.error.code === 'VALIDATION_ERROR' ? null : create.error

  if (!can(user?.role, 'CREATE_DOCUMENT')) return <Navigate to="/receiving" replace />

  const submit = form.onSubmit((v) => {
    setSubmitted(true)
    if (!linesValid(lines)) return
    create.mutate({
      supplierName: v.supplierName,
      referenceNumber: v.referenceNumber || null,
      expectedDate: v.expectedDate || null,
      notes: v.notes || null,
      items: lines.map((l) => ({ productId: l.product!.id, expectedQuantity: Number(l.expectedQuantity) })),
    })
  })

  return (
    <form onSubmit={submit}>
      <Stack maw={800}>
        <Title order={2}>New receiving document</Title>
        <ErrorAlert error={formError} />
        <TextInput label="Supplier name" required maxLength={200} {...form.getInputProps('supplierName')} />
        <Group grow>
          <TextInput label="Reference number" maxLength={100} {...form.getInputProps('referenceNumber')} />
          <TextInput label="Expected date" type="date" {...form.getInputProps('expectedDate')} />
        </Group>
        <Textarea label="Notes" maxLength={1000} {...form.getInputProps('notes')} />
        <Title order={4}>Lines</Title>
        <LineEditor lines={lines} onChange={setLines} showErrors={submitted} />
        <Group>
          <Button type="submit" loading={create.isPending}>
            Create draft
          </Button>
          <Button variant="default" onClick={() => navigate('/receiving')}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

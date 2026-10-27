import { Button, Group, Modal, Stack, Textarea } from '@mantine/core'
import { useState } from 'react'
import { ErrorAlert } from './ErrorAlert'

interface Props {
  title: string
  confirmLabel: string
  onConfirm: (reason: string) => void
  onClose: () => void
  loading: boolean
  error: unknown
}

/** Asks for the mandatory reason of cancel, close short and reverse (BR-15, BR-17): 3–500 characters, trimmed. */
export function ReasonDialog({ title, confirmLabel, onConfirm, onClose, loading, error }: Props) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = trimmed.length < 3 || trimmed.length > 500

  return (
    <Modal opened onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (!invalid) onConfirm(trimmed)
        }}
      >
        <Stack>
          <ErrorAlert error={error} />
          <Textarea
            label="Reason"
            required
            autosize
            minRows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            error={touched && invalid ? 'Reason must be 3–500 characters' : null}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Back
            </Button>
            <Button type="submit" color="red" loading={loading}>
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

import { Badge } from '@mantine/core'
import type { ReceivingStatus } from '../api/types'
import { statusLabel } from './rules'

const COLOR: Record<ReceivingStatus, string> = {
  DRAFT: 'gray',
  OPEN: 'blue',
  IN_PROGRESS: 'yellow',
  COMPLETED: 'green',
  CLOSED_SHORT: 'orange',
  CANCELLED: 'red',
}

export function StatusBadge({ status }: { status: ReceivingStatus }) {
  return (
    <Badge color={COLOR[status]} variant="light">
      {statusLabel(status)}
    </Badge>
  )
}

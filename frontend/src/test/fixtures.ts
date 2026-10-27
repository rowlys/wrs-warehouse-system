import type { ReceivingDocumentDetail, ReceivingItem, Receipt } from '../api/types'

export const DOC_ID = '20000000-0000-0000-0000-000000000001'

export const item = (over: Partial<ReceivingItem> = {}): ReceivingItem => ({
  id: '30000000-0000-0000-0000-000000000001',
  product: { id: '10000000-0000-0000-0000-000000000001', sku: 'FRZ-CHK-001', name: 'Frozen Chicken', unitOfMeasure: 'CTN' },
  expectedQuantity: 100,
  receivedQuantity: 0,
  remainingQuantity: 100,
  isFullyReceived: false,
  ...over,
})

export const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: '40000000-0000-0000-0000-000000000001',
  receivingItemId: item().id,
  productSku: 'FRZ-CHK-001',
  quantity: 40,
  receivedAt: '2026-10-27T09:00:00.000Z',
  receivedBy: { id: 'u1', fullName: 'Budi Operator' },
  reversal: null,
  ...over,
})

export const doc = (over: Partial<ReceivingDocumentDetail> = {}): ReceivingDocumentDetail => ({
  id: DOC_ID,
  documentNumber: 'RCV-2026-000001',
  supplierName: 'PT Sumber Beku',
  referenceNumber: null,
  expectedDate: null,
  status: 'DRAFT',
  itemCount: 1,
  totalExpectedQuantity: 100,
  totalReceivedQuantity: 0,
  createdAt: '2026-10-27T08:00:00.000Z',
  createdBy: { id: 'u2', fullName: 'Siti Supervisor' },
  notes: null,
  allItemsReceived: false,
  items: [item()],
  receipts: [],
  openedAt: null,
  openedBy: null,
  completedAt: null,
  completedBy: null,
  closedShortAt: null,
  closedShortBy: null,
  closeShortReason: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  updatedAt: '2026-10-27T08:00:00.000Z',
  ...over,
})

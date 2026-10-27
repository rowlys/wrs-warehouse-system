// Mirrors docs/openapi.yaml components.schemas (only the shapes the pages use so far).

export type Role = 'OPERATOR' | 'SUPERVISOR'

export interface User {
  id: string
  username: string
  fullName: string
  role: Role
}

export interface UserRef {
  id: string
  fullName: string
}

export interface LoginResponse {
  accessToken: string
  expiresIn: number
  user: User
}

export interface PageMeta {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface Page<T> {
  data: T[]
  meta: PageMeta
}

export interface Product {
  id: string
  sku: string
  name: string
  unitOfMeasure: string
  description: string | null
  quantityOnHand: number
  createdAt: string
  updatedAt: string
}

export interface CreateProductRequest {
  sku: string
  name: string
  unitOfMeasure: string
  description?: string | null
}

export const RECEIVING_STATUSES = [
  'DRAFT',
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'CLOSED_SHORT',
  'CANCELLED',
] as const
export type ReceivingStatus = (typeof RECEIVING_STATUSES)[number]

export interface ReceivingItemInput {
  productId: string
  expectedQuantity: number
}

export interface CreateReceivingDocumentRequest {
  supplierName: string
  referenceNumber?: string | null
  expectedDate?: string | null
  notes?: string | null
  items?: ReceivingItemInput[]
}

export interface ReceivingDocumentSummary {
  id: string
  documentNumber: string
  supplierName: string
  referenceNumber: string | null
  expectedDate: string | null
  status: ReceivingStatus
  itemCount: number
  totalExpectedQuantity: number
  totalReceivedQuantity: number
  createdAt: string
  createdBy: UserRef
}

export interface ReceivingItem {
  id: string
  product: { id: string; sku: string; name: string; unitOfMeasure: string }
  expectedQuantity: number
  receivedQuantity: number
  /** The shortage once the document is CLOSED_SHORT. */
  remainingQuantity: number
  isFullyReceived: boolean
}

export interface ReceiptReversal {
  id: string
  reason: string
  reversedAt: string
  reversedBy: UserRef
}

export interface Receipt {
  id: string
  receivingItemId: string
  productSku: string
  quantity: number
  receivedAt: string
  receivedBy: UserRef
  reversal: ReceiptReversal | null
}

export interface ReceivingDocumentDetail extends ReceivingDocumentSummary {
  notes: string | null
  allItemsReceived: boolean
  items: ReceivingItem[]
  receipts: Receipt[]
  openedAt: string | null
  openedBy: UserRef | null
  completedAt: string | null
  completedBy: UserRef | null
  closedShortAt: string | null
  closedShortBy: UserRef | null
  closeShortReason: string | null
  cancelledAt: string | null
  cancelledBy: UserRef | null
  cancelReason: string | null
  updatedAt: string
}

export interface ReceiptResult {
  receipt: Receipt
  item: ReceivingItem
  document: { id: string; documentNumber: string; status: ReceivingStatus; allItemsReceived: boolean }
  inventory: { productId: string; quantityOnHand: number }
}

export interface InventoryBalance {
  productId: string
  sku: string
  name: string
  unitOfMeasure: string
  quantityOnHand: number
  updatedAt: string
}

export interface InventoryTransaction {
  /** bigint ledger id, serialized as a string. */
  id: string
  type: 'RECEIPT' | 'RECEIPT_REVERSAL'
  product: { id: string; sku: string; name: string }
  quantityChange: number
  balanceAfter: number
  receiptId: string | null
  receiptReversalId: string | null
  receivingDocument: { id: string; documentNumber: string } | null
  createdBy: UserRef
  createdAt: string
}

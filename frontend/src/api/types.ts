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

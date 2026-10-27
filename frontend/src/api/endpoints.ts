import { api } from './client'
import type {
  CreateProductRequest,
  CreateReceivingDocumentRequest,
  LoginResponse,
  Page,
  Product,
  ReceiptResult,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingStatus,
  User,
} from './types'

interface PageParams {
  page?: number
  pageSize?: number
  search?: string
}

export const login = (username: string, password: string) =>
  api<LoginResponse>('/auth/login', { method: 'POST', body: { username, password } })

export const getMe = () => api<User>('/auth/me')

export const listProducts = (query: PageParams) =>
  api<Page<Product>>('/products', { query: { ...query } })

export const createProduct = (body: CreateProductRequest) =>
  api<Product>('/products', { method: 'POST', body })

export const listDocuments = (query: PageParams & { status?: ReceivingStatus }) =>
  api<Page<ReceivingDocumentSummary>>('/receiving-documents', { query: { ...query } })

export const createDocument = (body: CreateReceivingDocumentRequest) =>
  api<ReceivingDocumentDetail>('/receiving-documents', { method: 'POST', body })

const doc = (id: string) => `/receiving-documents/${id}`

export const getDocument = (id: string) => api<ReceivingDocumentDetail>(doc(id))

export const addItem = (id: string, productId: string, expectedQuantity: number) =>
  api<ReceivingDocumentDetail>(`${doc(id)}/items`, { method: 'POST', body: { productId, expectedQuantity } })

export const updateItem = (id: string, itemId: string, expectedQuantity: number) =>
  api<ReceivingDocumentDetail>(`${doc(id)}/items/${itemId}`, { method: 'PATCH', body: { expectedQuantity } })

export const removeItem = (id: string, itemId: string) =>
  api<void>(`${doc(id)}/items/${itemId}`, { method: 'DELETE' })

/** Open and complete take no body; cancel and close-short need a reason (BR-15, BR-17). */
export const changeStatus = (id: string, action: 'open' | 'complete' | 'cancel' | 'close-short', reason?: string) =>
  api<ReceivingDocumentDetail>(`${doc(id)}/${action}`, {
    method: 'POST',
    body: reason === undefined ? undefined : { reason },
  })

/** FR-33: the same key on a retry returns the original receipt instead of receiving twice. */
export const recordReceipt = (id: string, itemId: string, quantity: number, idempotencyKey: string) =>
  api<ReceiptResult>(`${doc(id)}/items/${itemId}/receipts`, {
    method: 'POST',
    body: { quantity },
    headers: { 'Idempotency-Key': idempotencyKey },
  })

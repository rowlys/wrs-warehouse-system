import { api } from './client'
import type {
  CreateProductRequest,
  CreateReceivingDocumentRequest,
  LoginResponse,
  Page,
  Product,
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

// Returns ReceivingDocumentDetail, a superset of the summary.
export const createDocument = (body: CreateReceivingDocumentRequest) =>
  api<ReceivingDocumentSummary>('/receiving-documents', { method: 'POST', body })

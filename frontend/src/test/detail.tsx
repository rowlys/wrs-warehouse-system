import { Route, Routes } from 'react-router'
import type { ReceivingDocumentDetail, Role } from '../api/types'
import { DocumentDetailPage } from '../pages/DocumentDetailPage'
import { DOC_ID } from './fixtures'
import { renderPage, type Handler } from './utils'

/** Renders the detail page of `detail` as `as`; `routes` adds or overrides mocked requests. */
export function renderDetail(as: Role, detail: ReceivingDocumentDetail, routes: Record<string, Handler> = {}) {
  return renderPage(
    <Routes>
      <Route path="/receiving/:id" element={<DocumentDetailPage />} />
    </Routes>,
    {
      as,
      path: `/receiving/${DOC_ID}`,
      routes: {
        [`GET /api/v1/receiving-documents/${DOC_ID}`]: () => ({ status: 200, body: detail }),
        'GET /api/v1/products': () => ({
          status: 200,
          body: { data: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } },
        }),
        ...routes,
      },
    },
  )
}

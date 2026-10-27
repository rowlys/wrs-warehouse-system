import { Select } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { listProducts } from '../api/endpoints'
import type { Product } from '../api/types'

export type ProductOption = Pick<Product, 'id' | 'sku' | 'name'>

const label = (p: ProductOption) => `${p.sku} — ${p.name}`

interface Props {
  value: ProductOption | null
  onChange: (product: ProductOption | null) => void
  /** Products already on another line (BR-06): shown but not selectable. */
  takenIds?: string[]
  error?: string | null
  /** Offer an ✕ to empty the choice, e.g. to drop a filter. */
  clearable?: boolean
}

/** Searchable product select; the search runs on the server (SKU or name, FR-10). */
export function ProductPicker({ value, onChange, takenIds = [], error, clearable }: Props) {
  const [search, setSearch] = useState('')
  // After a pick the search box shows the label; that is not a new search.
  const term = value && search === label(value) ? '' : search.trim()
  const [debounced] = useDebouncedValue(term, 300)
  const results = useQuery({
    queryKey: ['products', { search: debounced, page: 1 }],
    queryFn: () => listProducts({ search: debounced }),
  })

  const products = results.data?.data ?? []
  const options = value && !products.some((p) => p.id === value.id) ? [value, ...products] : products

  return (
    <Select
      aria-label="Product"
      placeholder="Search SKU or name"
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options}
      data={options.map((p) => ({ value: p.id, label: label(p), disabled: takenIds.includes(p.id) }))}
      value={value?.id ?? null}
      onChange={(id) => onChange(options.find((p) => p.id === id) ?? null)}
      nothingFoundMessage={results.isFetching ? 'Searching…' : 'No products found'}
      error={error}
      clearable={clearable}
    />
  )
}

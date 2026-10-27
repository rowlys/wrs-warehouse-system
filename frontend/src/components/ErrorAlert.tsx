import { Alert } from '@mantine/core'

/** NFR-06: shows the API's plain-language message. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return (
    <Alert color="red" role="alert">
      {message}
    </Alert>
  )
}

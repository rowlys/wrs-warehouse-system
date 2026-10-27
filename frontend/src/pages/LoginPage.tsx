import { Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { ErrorAlert } from '../components/ErrorAlert'

export function LoginPage() {
  const { login, isLoggedIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  // AC-01.1: after logging in the user lands on the receiving list.
  if (isLoggedIn) return <Navigate to="/receiving" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
    } catch (err) {
      setError(err)
      setSubmitting(false)
    }
  }

  return (
    <Center h="100vh">
      <Paper withBorder p="xl" w={360}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>Warehouse Receiving</Title>
            <ErrorAlert error={error} />
            <TextInput
              label="Username"
              required
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              required
              maxLength={100}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={submitting}>
              Log in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}

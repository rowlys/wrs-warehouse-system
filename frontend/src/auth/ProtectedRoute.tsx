import { Center, Loader } from '@mantine/core'
import { Navigate, Outlet } from 'react-router'
import { useAuth } from './useAuth'

/** Renders child routes only with a session; otherwise sends the user to /login. */
export function ProtectedRoute() {
  const { isLoggedIn, isLoading } = useAuth()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }
  return <Outlet />
}

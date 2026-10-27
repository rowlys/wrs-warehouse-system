import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { clearToken, getToken, setToken } from '../api/client'
import { getMe, login as loginRequest } from '../api/endpoints'
import { AuthContext } from './useAuth'

/** Holds the session: the token in sessionStorage, the user from /auth/me. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [isLoggedIn, setLoggedIn] = useState(() => !!getToken())
  const me = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: isLoggedIn, staleTime: Infinity })

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await loginRequest(username, password)
      setToken(res.accessToken)
      queryClient.setQueryData(['me'], res.user)
      setLoggedIn(true)
    },
    [queryClient],
  )

  // FR-05: discarding the token is the whole logout; there is no server session.
  const logout = useCallback(() => {
    clearToken()
    queryClient.clear()
    setLoggedIn(false)
    navigate('/login')
  }, [queryClient, navigate])

  const value = useMemo(
    () => ({ user: me.data, isLoggedIn, isLoading: isLoggedIn && me.isPending, login, logout }),
    [me.data, me.isPending, isLoggedIn, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

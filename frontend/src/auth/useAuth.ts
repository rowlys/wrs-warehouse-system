import { createContext, useContext } from 'react'
import type { User } from '../api/types'

export interface Auth {
  user: User | undefined
  isLoggedIn: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}

export const useCurrentUser = () => useAuth().user

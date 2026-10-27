import { AppShell, Badge, Button, Group, NavLink, Text, Title } from '@mantine/core'
import { NavLink as RouterLink, Outlet } from 'react-router'
import { useAuth } from '../auth/useAuth'

const NAV = [
  { to: '/receiving', label: 'Receiving' },
  { to: '/products', label: 'Products' },
  { to: '/inventory', label: 'Inventory', end: true },
  { to: '/inventory/transactions', label: 'Transactions' },
]

export function AppLayout() {
  const { user, logout } = useAuth()
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 200, breakpoint: 0 }} padding="md">
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between">
          <Title order={4}>Warehouse Receiving</Title>
          <Group gap="sm">
            <Text size="sm">{user?.fullName}</Text>
            <Badge variant="light">{user?.role}</Badge>
            <Button variant="subtle" size="xs" onClick={logout}>
              Log out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV.map((n) => (
          <RouterLink key={n.to} to={n.to} end={n.end} style={{ textDecoration: 'none' }}>
            {({ isActive }) => <NavLink component="span" label={n.label} active={isActive} />}
          </RouterLink>
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}

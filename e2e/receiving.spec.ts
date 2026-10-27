import { expect, test, type Page } from '@playwright/test'

const PASSWORDS = {
  supervisor: process.env.SEED_SUPERVISOR_PASSWORD,
  operator: process.env.SEED_OPERATOR_PASSWORD,
}

async function login(page: Page, username: keyof typeof PASSWORDS) {
  const password = PASSWORDS[username]
  if (!password) throw new Error(`Set SEED_${username.toUpperCase()}_PASSWORD (read from .env)`)
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Receiving documents' })).toBeVisible()
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
}

async function createProduct(page: Page, sku: string, name: string) {
  await page.getByRole('button', { name: 'New product' }).click()
  const dialog = page.getByRole('dialog', { name: 'New product' })
  await dialog.getByLabel('SKU').fill(sku)
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Unit of measure').fill('CTN')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()
}

async function receive(page: Page, sku: string, quantity: number) {
  const row = page.getByRole('row').filter({ hasText: sku })
  await row.getByLabel(`Quantity to receive of ${sku}`).fill(String(quantity))
  await row.getByRole('button', { name: 'Receive' }).click()
  await expect(page.getByText(`Received ${quantity} CTN of ${sku}`)).toBeVisible()
}

// Unique per run, so the test can repeat against the same stack.
const run = Date.now().toString(36).toUpperCase()
const skuA = `E2E-${run}-A`
const skuB = `E2E-${run}-B`

test('T-E2E-01 US-03–US-06 supervisor plans, operator receives, supervisor completes, stock and ledger agree', async ({
  page,
}) => {
  // US-02/US-03: supervisor creates two products and a document with two lines, then opens it.
  await login(page, 'supervisor')
  await page.getByRole('link', { name: 'Products' }).click()
  await createProduct(page, skuA, `E2E chicken ${run}`)
  await createProduct(page, skuB, `E2E tuna ${run}`)

  await page.getByRole('link', { name: 'Receiving' }).click()
  await page.getByRole('link', { name: 'New document' }).click()
  await page.getByLabel('Supplier name').fill(`E2E Supplier ${run}`)
  for (const [i, [sku, qty]] of ([[skuA, 10], [skuB, 5]] as const).entries()) {
    await page.getByRole('button', { name: 'Add line' }).click()
    await page.getByRole('textbox', { name: 'Product' }).nth(i).fill(sku)
    await page.getByRole('option', { name: new RegExp(sku) }).click()
    await page.getByLabel('Expected quantity').nth(i).fill(String(qty))
  }
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
  const documentUrl = page.url()
  const documentNumber = await page.getByRole('heading', { level: 2 }).innerText()

  await page.getByRole('button', { name: 'Open for receiving' }).click()
  await expect(page.getByText('Open', { exact: true })).toBeVisible()
  await logout(page)

  // US-04: operator receives a partial, then the rest.
  await login(page, 'operator')
  await page.goto(documentUrl)
  await receive(page, skuA, 4)
  await expect(page.getByText('In progress', { exact: true })).toBeVisible()
  await receive(page, skuA, 6)
  await receive(page, skuB, 5)
  await expect(page.getByText('All items received — ready to complete')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Complete' })).toHaveCount(0)
  await logout(page)

  // US-05: supervisor completes.
  await login(page, 'supervisor')
  await page.goto(documentUrl)
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  await page.getByRole('button', { name: 'Complete document' }).click()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()

  // US-06: inventory shows the totals, and the ledger has one row per receipt.
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.getByLabel('Search inventory').fill(`E2E-${run}`)
  await expect(page.getByRole('row').filter({ hasText: skuA })).toContainText('10')
  await expect(page.getByRole('row').filter({ hasText: skuB })).toContainText('5')

  await page.getByRole('link', { name: 'Transactions' }).click()
  await expect(page.getByRole('row').filter({ hasText: documentNumber })).toHaveCount(3)
})

test('T-E2E-02 AC-02.5 operator does not see the "New product" button', async ({ page }) => {
  await login(page, 'operator')
  await page.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New product' })).toHaveCount(0)
})

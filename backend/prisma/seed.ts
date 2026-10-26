// Idempotent seed (spec §3.4): upserts keyed on username and sku, safe to run on every start.
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';

const BCRYPT_COST = 10;

const users = [
  {
    username: 'supervisor',
    fullName: 'Siti Supervisor',
    role: UserRole.SUPERVISOR,
    passwordEnv: 'SEED_SUPERVISOR_PASSWORD',
  },
  {
    username: 'operator',
    fullName: 'Budi Operator',
    role: UserRole.OPERATOR,
    passwordEnv: 'SEED_OPERATOR_PASSWORD',
  },
];

const products = [
  {
    sku: 'FRZ-CHK-001',
    name: 'Frozen Chicken Breast 1kg',
    unitOfMeasure: 'CTN',
  },
  { sku: 'FRZ-FSH-002', name: 'Frozen Tuna Loin', unitOfMeasure: 'CTN' },
  { sku: 'CHL-DRY-003', name: 'UHT Milk 1L', unitOfMeasure: 'CTN' },
  {
    sku: 'FRZ-VEG-004',
    name: 'Frozen Mixed Vegetables 500g',
    unitOfMeasure: 'PCS',
  },
  { sku: 'CHL-MEA-005', name: 'Beef Sirloin Chilled', unitOfMeasure: 'PCS' },
];

async function main() {
  const missing = users
    .map((u) => u.passwordEnv)
    .filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Seed aborted: ${missing.join(', ')} must be set`);
  }

  const prisma = new PrismaClient();
  try {
    for (const { passwordEnv, ...user } of users) {
      const passwordHash = await hash(process.env[passwordEnv]!, BCRYPT_COST);
      // Existing users are left untouched.
      await prisma.user.upsert({
        where: { username: user.username },
        update: {},
        create: { ...user, passwordHash },
      });
    }
    for (const product of products) {
      await prisma.product.upsert({
        where: { sku: product.sku },
        update: {},
        create: {
          ...product,
          inventoryBalance: { create: { quantityOnHand: 0 } },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(`Seeded ${users.length} users and ${products.length} products`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

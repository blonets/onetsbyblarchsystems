/**
 * Prisma seed: roles, a superadmin user, and a demo site.
 *
 * Run with: `pnpm --filter @mtk/api exec prisma db seed`
 * (wired via the `prisma.seed` key in apps/api/package.json).
 *
 * Env:
 * - SEED_ADMIN_EMAIL (default: admin@panel.local)
 * - SEED_ADMIN_NAME (default: "Platform Admin")
 * - SEED_ADMIN_PASSWORD (REQUIRED — the script refuses to run without it;
 *   never commit a real password; pass it via the environment only)
 * - SEED_DEMO_SITE (default: "true" — set to "false" to skip the demo site)
 *
 * Idempotent: safe to re-run (upserts by unique keys).
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';

const prisma = new PrismaClient();

const ROLES: Array<{ name: string; description: string }> = [
  { name: 'viewer', description: 'Read-only dashboards.' },
  { name: 'technician', description: 'Onboard routers + view. Cannot change hotspot/firewall/queues.' },
  { name: 'operator', description: 'Technician + hotspot/firewall/queues management.' },
  { name: 'admin', description: 'Full control: users, secret rotation, restores.' },
];

async function main(): Promise<void> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is not set — refusing to seed an admin with a default password. ' +
        'Set it in the environment (never in a file) and re-run.',
    );
  }

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  // eslint-disable-next-line no-console
  console.log('seed: roles upserted (viewer, technician, operator, admin)');

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@panel.local';
  const name = process.env.SEED_ADMIN_NAME ?? 'Platform Admin';
  const admin = await prisma.user.upsert({
    where: { email },
    update: { roleId: adminRole.id, disabledAt: null },
    create: {
      email,
      name,
      passwordHash: await hashPassword(adminPassword),
      roleId: adminRole.id,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`seed: superadmin upserted (${admin.email})`);

  if (process.env.SEED_DEMO_SITE !== 'false') {
    const site = await prisma.site.upsert({
      where: { slug: 'demo-site' },
      update: {},
      create: {
        name: 'Demo Site',
        slug: 'demo-site',
        city: 'Cairo',
        country: 'EG',
        notes: 'Seeded demo site — delete or repurpose before production use.',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`seed: demo site upserted (${site.slug})`);
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed failed:', (err as Error).message);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

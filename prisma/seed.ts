import 'dotenv/config';
import { MembershipRole, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development seed is disabled in production.');
  }
  const email = process.env.SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_PASSWORD;
  const organizationName = process.env.SEED_ORGANIZATION?.trim() || 'Development Workspace';
  if (!email || !password || password.length < 12) {
    throw new Error('Set SEED_EMAIL and a SEED_PASSWORD with at least 12 characters in .env.');
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash },
    });
    const organization = await prisma.organization.upsert({
      where: { slug: 'development-workspace' },
      update: {},
      create: { name: organizationName, slug: 'development-workspace' },
    });
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      update: { role: MembershipRole.OWNER },
      create: {
        userId: user.id,
        organizationId: organization.id,
        role: MembershipRole.OWNER,
      },
    });
    await prisma.instagramAccountSettings.upsert({
      where: { organizationId: organization.id },
      update: {},
      create: {
        organizationId: organization.id,
        maxActiveAccounts: Number(process.env.INSTAGRAM_DEFAULT_ORGANIZATION_ACCOUNT_LIMIT ?? 10),
        maxGroups: Number(process.env.INSTAGRAM_DEFAULT_ORGANIZATION_GROUP_LIMIT ?? 20),
      },
    });
    process.stdout.write(`Development owner ready: ${user.email}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Seed failed'}\n`);
  process.exitCode = 1;
});

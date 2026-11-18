import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed-demo.ts' },
  // `prisma generate` doesn't connect, so builds (CI, Docker) work without DATABASE_URL;
  // migrate/studio need the real value.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://build:build@localhost:5432/build' },
});

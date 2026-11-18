/**
 * Demo data for exploring the UI without real integrations:
 *   npm run db:seed:demo -w @cadence/api
 * Creates 2 tribes, 4 teams, 14 members, 60 days of activity and production deployments
 * under two disabled demo connections (Azure DevOps + Jira). Safe to re-run (it replaces its own data).
 * All demo accounts use the password "demo-password-123".
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DAY = 864e5;
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

const ORG = [
  {
    lead: ['Ahmed Mostafa', 'ahmed@demo.cadence'],
    tribe: 'Retail',
    teams: [
      {
        em: ['Michael Ramzy', 'michael@demo.cadence'],
        members: ['Bassam Adel', 'Mina Samir', 'Yasmine Hamdy', 'Karim Fathy'],
        services: ['storefront-api', 'catalog'],
      },
      {
        em: ['Rana Abdelaziz', 'rana@demo.cadence'],
        members: ['Omar Elshamy', 'Mariam Ashraf', 'Kirollos Nabil'],
        services: ['checkout-web'],
      },
    ],
  },
  {
    lead: ['Hoda Khaled', 'hoda@demo.cadence'],
    tribe: 'Growth',
    teams: [
      {
        em: ['Sherif Ayad', 'sherif@demo.cadence'],
        members: ['Mahmoud Saeed', 'Christine Wagih', 'Tamer Galal', 'Nada Mansour'],
        services: ['growth-api', 'experiments'],
      },
      {
        em: ['Dina Fouad', 'dina@demo.cadence'],
        members: ['Mohamed Ragab', 'Andrew Samy', 'Salma Ibrahim'],
        services: ['marketing-site'],
      },
    ],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash('demo-password-123', 10);
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  await prisma.integrationConnection.deleteMany({ where: { name: { startsWith: 'Demo' } } });
  await prisma.member.deleteMany({ where: { manager: { email: { endsWith: '@demo.cadence' } } } });
  await prisma.user.deleteMany({ where: { role: 'ENGINEERING_MANAGER', email: { endsWith: '@demo.cadence' } } });
  await prisma.user.deleteMany({ where: { role: 'TRIBE_LEAD', email: { endsWith: '@demo.cadence' } } });

  // Code activity + deployments come from Azure DevOps, work items from Jira (disabled: never synced).
  const ado = await prisma.integrationConnection.create({
    data: {
      name: 'Demo · Azure DevOps',
      provider: 'AZURE_DEVOPS',
      baseUrl: 'https://dev.azure.com/demo',
      encryptedSecret: 'demo',
      enabled: false,
      config: { projects: ['Retail', 'Growth'] },
    },
  });
  const jira = await prisma.integrationConnection.create({
    data: {
      name: 'Demo · Jira',
      provider: 'JIRA',
      baseUrl: 'https://demo.atlassian.net',
      encryptedSecret: 'demo',
      enabled: false,
      config: { deployment: 'cloud', storyPointsField: 'customfield_10016' },
    },
  });
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();

  for (const tribe of ORG) {
    const lead = await prisma.user.create({
      data: {
        name: tribe.lead[0],
        email: tribe.lead[1],
        role: 'TRIBE_LEAD',
        tribeName: tribe.tribe,
        passwordHash,
        reportsToId: admin?.id,
      },
    });
    for (const team of tribe.teams) {
      const em = await prisma.user.create({
        data: { name: team.em[0], email: team.em[1], role: 'ENGINEERING_MANAGER', passwordHash, reportsToId: lead.id },
      });
      for (const name of team.members) {
        const member = await prisma.member.create({
          data: {
            name,
            title: pick(0, 3) ? 'Software Engineer' : 'Senior Engineer',
            managerId: em.id,
            email: `${name.split(' ')[0].toLowerCase()}@demo.cadence`,
          },
        });
        const first = name.split(' ')[0].toLowerCase();
        await prisma.externalIdentity.createMany({
          data: [
            { memberId: member.id, connectionId: ado.id, username: `${first}@demo.cadence` },
            { memberId: member.id, connectionId: jira.id, username: `acc-${first}` },
          ],
        });
        const pace = 0.6 + rand() * 0.8;
        const rows = [];
        const items: { key: string; date: Date; storyPoints: number; cycleTimeHours: number; memberId: string }[] = [];
        for (let d = 59; d >= 0; d--) {
          const date = new Date(today - d * DAY);
          if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
          const issues = rand() < 0.45 * pace ? pick(1, 2) : 0;
          const done = Array.from({ length: issues }, () => ({ points: pick(1, 5), cycle: 12 + rand() * 90 }));
          for (const [n, item] of done.entries()) {
            items.push({
              key: `DEMO-${first}-${d}-${n}`,
              date,
              storyPoints: item.points,
              cycleTimeHours: item.cycle,
              memberId: member.id,
            });
          }
          rows.push({
            memberId: member.id,
            connectionId: ado.id,
            date,
            commits: Math.round(pick(0, 6) * pace),
            prsRaised: rand() < 0.35 * pace ? 1 : 0,
            prsMerged: rand() < 0.3 * pace ? 1 : 0,
            prsReviewed: Math.round(pick(0, 3) * pace),
          });
          rows.push({
            memberId: member.id,
            connectionId: jira.id,
            date,
            issuesCompleted: issues,
            storyPoints: done.reduce((n, i) => n + i.points, 0),
            cycleTimeHoursSum: done.reduce((n, i) => n + i.cycle, 0),
            cycleTimeSamples: issues,
          });
        }
        await prisma.dailyMetric.createMany({ data: rows });
        for (const { memberId, ...item } of items) {
          await prisma.workItem.create({
            data: { ...item, connectionId: jira.id, contributors: { create: { memberId } } },
          });
        }
      }
      for (const svc of team.services) {
        const service = await prisma.deliveryService.create({
          data: { connectionId: ado.id, name: `${tribe.tribe}/${svc}-deploy`, managerId: em.id },
        });
        const deploys = [];
        let id = 0;
        for (let d = 59; d >= 0; d--) {
          const day = today - d * DAY;
          if (new Date(day).getUTCDay() % 6 === 0) continue;
          for (let n = 0; n < pick(0, 2); n++) {
            const failed = rand() < 0.12;
            deploys.push({
              serviceId: service.id,
              externalId: String(++id),
              environment: 'production',
              status: failed ? ('FAILED' as const) : ('SUCCESS' as const),
              finishedAt: new Date(day + pick(9, 17) * 36e5),
              leadTimeHours: failed ? null : 2 + rand() * 60,
            });
          }
        }
        await prisma.deployment.createMany({ data: deploys });
      }
    }
  }
  console.log('Demo data ready. Demo logins use password "demo-password-123", e.g. ahmed@demo.cadence');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

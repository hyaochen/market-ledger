// T-ML-018 production migration：把 5 個新品項補到既有租戶
//
// 跑法（在 docker container 內，避免 host 跟 container 的 SQLite 檔案不同步）：
//   docker compose exec market-ledger npx tsx scripts/seed-items-T-ML-018.ts
//
// idempotent：用 upsert，已存在就不動；不會覆寫 sortOrder（不像 prisma/seed.ts
// 會把整批 sortOrder 重排，避免影響 owner 自訂順序）

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 對應 bot/itemKeywords.ts；defaultUnit 都用「包」（pack）
const NEW_ITEMS: { name: string; code: string }[] = [
    { name: '味鮮A',        code: '16-1203G' },
    { name: '大骨高湯1600', code: '16-1600G' },
    { name: '大骨高湯1601', code: '16-1601G' },
    { name: '滷包香料',     code: '18-1101G' },
    { name: '滷汁粉',       code: '20-0023G' },
];

const DEFAULT_UNIT = 'pack';
const TARGET_CATEGORY = '其他';

async function main() {
    const tenants = await prisma.tenant.findMany({
        where: { status: true },
        select: { id: true, code: true, name: true },
    });

    if (tenants.length === 0) {
        console.warn('⚠️  No active tenants found, nothing to do.');
        return;
    }

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const tenant of tenants) {
        console.log(`\n── Tenant: ${tenant.name} (${tenant.code}) ──`);

        // 找「其他」分類；找不到就建（與 seed.ts 一致：sortOrder 99）
        let category = await prisma.category.findFirst({
            where: { name: TARGET_CATEGORY, tenantId: tenant.id },
        });
        if (!category) {
            category = await prisma.category.create({
                data: { name: TARGET_CATEGORY, sortOrder: 99, tenantId: tenant.id },
            });
            console.log(`   ➕ Created category 「${TARGET_CATEGORY}」`);
        }

        // 找目前該分類最大 sortOrder，新增的接續往後排
        const maxSort = await prisma.item.aggregate({
            where: { categoryId: category.id, tenantId: tenant.id },
            _max: { sortOrder: true },
        });
        let nextSort = (maxSort._max.sortOrder ?? 0) + 1;

        for (const item of NEW_ITEMS) {
            const existing = await prisma.item.findUnique({
                where: {
                    name_categoryId_tenantId: {
                        name: item.name,
                        categoryId: category.id,
                        tenantId: tenant.id,
                    },
                },
            });
            if (existing) {
                // 不動既有 sortOrder / isActive — owner 可能已手動調過
                console.log(`   = ${item.name} (${item.code}) — already exists, skipped`);
                totalSkipped++;
                continue;
            }
            await prisma.item.create({
                data: {
                    name: item.name,
                    categoryId: category.id,
                    defaultUnit: DEFAULT_UNIT,
                    sortOrder: nextSort++,
                    tenantId: tenant.id,
                    isActive: true,
                },
            });
            console.log(`   + ${item.name} (${item.code}) created`);
            totalCreated++;
        }
    }

    console.log(`\n✅ Done. Created ${totalCreated}, skipped (already existed) ${totalSkipped}.`);
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error('❌ Migration failed:', e);
        await prisma.$disconnect();
        process.exit(1);
    });

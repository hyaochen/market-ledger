import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

function hashPassword(plain: string): string {
    return bcrypt.hashSync(plain, 12)
}

const prisma = new PrismaClient()

async function main() {
    // ─── 0. 建立預設租戶 ───
    const defaultTenant = await prisma.tenant.upsert({
        where: { code: 'default' },
        update: {},
        create: {
            name: '預設企業',
            code: 'default',
            status: true,
            note: '系統預設企業',
        },
    })
    const tenantId = defaultTenant.id

    // ─── 1. 建立區域 ───
    const defaultRegion = await prisma.region.upsert({
        where: { name_tenantId: { name: '屏東地區', tenantId } },
        update: {},
        create: {
            name: '屏東地區',
            code: 'pingtung',
            sortOrder: 1,
            tenantId,
        },
    })

    // ─── 2. 建立地點 (關聯到區域) ───
    const locationDefs = [
        { name: '屏東攤位', sortOrder: 1 },
        { name: '潮州攤位', sortOrder: 2 },
    ]

    for (const loc of locationDefs) {
        await prisma.location.upsert({
            where: { name_tenantId: { name: loc.name, tenantId } },
            update: { regionId: defaultRegion.id },
            create: {
                name: loc.name,
                regionId: defaultRegion.id,
                tenantId,
            },
        })
    }

    // ─── 3. 建立分類 ───
    const categories = [
        { name: '肉類', sortOrder: 1 },
        { name: '菜類', sortOrder: 2 },
        { name: '其他', sortOrder: 99 },
    ]

    for (const cat of categories) {
        await prisma.category.upsert({
            where: { name_tenantId: { name: cat.name, tenantId } },
            update: {},
            create: { name: cat.name, sortOrder: cat.sortOrder, tenantId },
        })
    }

    // ─── 4. 建立品項清單 ───
    const meatCat = await prisma.category.findFirst({ where: { name: '肉類', tenantId } })
    const vegCat = await prisma.category.findFirst({ where: { name: '菜類', tenantId } })
    const otherCat = await prisma.category.findFirst({ where: { name: '其他', tenantId } })

    const unitMap: Record<string, string> = {
        公斤: 'kg',
        斤: 'catty',
        臺斤: 'catty',
        捆: 'bundle',
        袋: 'bag',
        籃: 'basket',
        包: 'pack',
        條: 'strip',
        箱: 'box',
        桶: 'bucket',
    }

    const resolveDefaultUnit = (units: string[]) => unitMap[units[0]] ?? 'kg'

    const meatItems = [
        { name: '大腸', units: ['公斤', '包'] },
        { name: '大腸頭', units: ['公斤'] },
        { name: '豬耳', units: ['公斤'] },
        { name: '全頭皮', units: ['公斤'] },
        { name: '肝蓮', units: ['公斤', '斤'] },
        { name: '菊花肉', units: ['公斤'] },
        { name: '粉腸', units: ['公斤', '斤'] },
        { name: 'A豬尾', units: ['公斤'] },
        { name: 'B赤尾', units: ['公斤'] },
        { name: '中肉', units: ['公斤'] },
        { name: '腳', units: ['公斤'] },
        { name: '舌', units: ['斤'] },
        { name: '舌頭', units: ['公斤', '斤'] },
        { name: '豬皮', units: ['斤', '公斤'] },
        { name: '蹄膀', units: ['斤'] },
        { name: '尾巴', units: ['斤'] },
        { name: '腳筋', units: ['斤'] },
        { name: '五花', units: ['斤'] },
        { name: '豬油', units: ['斤'] },
        { name: '頭皮', units: ['公斤', '斤'] },
        { name: '大骨', units: ['公斤', '斤'] },
    ]

    const processedItems = [
        { name: '滷蛋', units: ['包'] },
        { name: '鳥蛋', units: ['桶'] },
        { name: '阿偉', units: ['斤'] },
        { name: '米血', units: ['包'] },
        { name: '貢丸', units: ['包'] },
        { name: '黑輪', units: ['包'] },
        { name: '魚丸', units: ['斤'] },
        { name: '豆腸', units: ['包'] },
        { name: '豆包', units: ['包'] },
    ]

    const vegetableItems = [
        { name: '蔥', units: ['捆'] },
        { name: '高麗菜', units: ['袋', '籃'] },
        { name: '紅蘿蔔', units: ['箱', '包', '條'] },
        { name: '白蘿蔔', units: ['箱', '包', '條'] },
        { name: '洋蔥', units: ['袋'] },
    ]

    const dryGoods = [
        { name: '筍片', units: ['箱'] },
        { name: '筍干', units: ['箱'] },
        { name: '鹹菜', units: ['箱'] },
        { name: '豆皮', units: ['包'] },
        { name: '大豆皮', units: ['包'] },
        { name: '大豆干', units: ['斤'] },
        { name: '小豆干', units: ['斤'] },
        { name: '海帶', units: ['斤'] },
        { name: '麵輪', units: ['包'] },
        { name: '麵腸', units: ['斤'] },
        { name: '百頁', units: ['包'] },
        { name: '杏鮑菇', units: ['包'] },
        { name: '香菇', units: ['斤'] },
        { name: '扁魚', units: ['斤'] },
        { name: '番茄醬', units: ['包'] },
    ]

    const upsertItems = async (
        categoryId: string | undefined,
        items: { name: string; units: string[] }[],
        sortOffset = 0,
    ) => {
        if (!categoryId) return
        for (const [index, item] of items.entries()) {
            const defaultUnit = resolveDefaultUnit(item.units)
            await prisma.item.upsert({
                where: { name_categoryId_tenantId: { name: item.name, categoryId, tenantId } },
                update: { defaultUnit, sortOrder: sortOffset + index + 1 },
                create: {
                    name: item.name,
                    categoryId,
                    defaultUnit,
                    sortOrder: sortOffset + index + 1,
                    tenantId,
                },
            })
        }
    }

    await upsertItems(meatCat?.id, meatItems)
    await upsertItems(vegCat?.id, vegetableItems)
    await upsertItems(otherCat?.id, processedItems)
    await upsertItems(otherCat?.id, dryGoods, processedItems.length)

    // ─── 5. 建立 Dictionary (支出類型) ───
    const expenseTypes = [
        { label: '租金', value: 'EXP001' },
        { label: '水電費', value: 'EXP002' },
        { label: '瓦斯', value: 'EXP003' },
        { label: '雜支', value: 'EXP004' },
    ]

    for (const exp of expenseTypes) {
        await prisma.dictionary.upsert({
            where: { category_value_tenantId: { category: 'expense_type', value: exp.value, tenantId } },
            update: { label: exp.label },
            create: { category: 'expense_type', label: exp.label, value: exp.value, tenantId },
        })
    }

    // ─── 6. 建立單位 (Dictionary: unit) ───
    const unitDefs = [
        { label: '公斤', value: 'kg', meta: { isWeight: true, toKg: 1 } },
        { label: '臺斤', value: 'catty', meta: { isWeight: true, toKg: 0.6 } },
        { label: '捆', value: 'bundle', meta: { isWeight: false } },
        { label: '袋', value: 'bag', meta: { isWeight: false } },
        { label: '籃', value: 'basket', meta: { isWeight: false } },
        { label: '包', value: 'pack', meta: { isWeight: false } },
        { label: '條', value: 'strip', meta: { isWeight: false } },
        { label: '箱', value: 'box', meta: { isWeight: false } },
        { label: '桶', value: 'bucket', meta: { isWeight: false } },
    ]

    for (const unit of unitDefs) {
        await prisma.dictionary.upsert({
            where: { category_value_tenantId: { category: 'unit', value: unit.value, tenantId } },
            update: { label: unit.label, meta: JSON.stringify(unit.meta) },
            create: { category: 'unit', label: unit.label, value: unit.value, meta: JSON.stringify(unit.meta), tenantId },
        })
    }

    // ─── 7. 建立預設角色 (全域，不分租戶) ───
    const roles = [
        { name: '讀取者', code: 'read', description: '僅能查看資料 (讀取權限)' },
        { name: '編輯者', code: 'write', description: '可新增與修改資料 (含讀取權限)' },
        { name: '管理者', code: 'admin', description: '可管理權限與功能設定 (含全部權限)' },
    ]

    for (const role of roles) {
        await prisma.role.upsert({
            where: { code: role.code },
            update: { name: role.name, description: role.description },
            create: { name: role.name, code: role.code, description: role.description },
        })
    }

    // ─── 8. 建立超級管理員 (無 tenantId) ───
    const adminRole = await prisma.role.findUnique({ where: { code: 'admin' } })
    if (adminRole) {
        const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123'
        if (!process.env.SUPER_ADMIN_PASSWORD) {
            console.warn('⚠️  WARNING: SUPER_ADMIN_PASSWORD not set in .env, using default "superadmin123".')
        }
        const hashedSuperPassword = hashPassword(superAdminPassword)

        // 使用 findFirst + create/update (因為 nullable tenantId 在 composite unique 中的 SQLite 限制)
        let superAdmin = await prisma.user.findFirst({
            where: { username: 'superadmin', isSuperAdmin: true },
        })

        if (superAdmin) {
            await prisma.user.update({
                where: { id: superAdmin.id },
                data: { password: hashedSuperPassword, status: true },
            })
        } else {
            superAdmin = await prisma.user.create({
                data: {
                    username: 'superadmin',
                    password: hashedSuperPassword,
                    realName: '超級管理員',
                    isSuperAdmin: true,
                    tenantId: null,
                    status: true,
                },
            })
        }

        await prisma.userRole.upsert({
            where: { userId_roleId: { userId: superAdmin.id, roleId: adminRole.id } },
            update: {},
            create: { userId: superAdmin.id, roleId: adminRole.id },
        })

        // ─── 9. 建立預設企業管理員 ───
        const rawPassword = process.env.ADMIN_PASSWORD || 'admin123'
        if (!process.env.ADMIN_PASSWORD) {
            console.warn('⚠️  WARNING: ADMIN_PASSWORD not set in .env, using default "admin123".')
        }
        const adminPassword = hashPassword(rawPassword)

        let tenantAdmin = await prisma.user.findFirst({
            where: { username: 'admin', tenantId },
        })

        if (tenantAdmin) {
            await prisma.user.update({
                where: { id: tenantAdmin.id },
                data: { password: adminPassword, status: true },
            })
        } else {
            tenantAdmin = await prisma.user.create({
                data: {
                    username: 'admin',
                    password: adminPassword,
                    realName: '系統管理者',
                    tenantId,
                    status: true,
                },
            })
        }

        await prisma.userRole.upsert({
            where: { userId_roleId: { userId: tenantAdmin.id, roleId: adminRole.id } },
            update: {},
            create: { userId: tenantAdmin.id, roleId: adminRole.id },
        })

        // ─── 10. CashCount 模組 seed（T-ML-002）──────────────────────
        // 帳號可用 .env 覆蓋；預設為老闆要求的 mom / 1
        const writeRole = await prisma.role.findUnique({ where: { code: 'write' } })
        const pingtungLocation = await prisma.location.findFirst({
            where: { name: '屏東攤位', tenantId },
        })

        if (writeRole && pingtungLocation) {
            const momUsername = process.env.CASH_ADMIN_USERNAME || 'mom'
            const momPassword = process.env.CASH_ADMIN_PASSWORD || 'mom123'
            const employeeUsername = process.env.CASH_EMPLOYEE_USERNAME || '1'
            const employeePassword = process.env.CASH_EMPLOYEE_PASSWORD || '1'

            if (!process.env.CASH_ADMIN_PASSWORD) {
                console.warn('⚠️  WARNING: CASH_ADMIN_PASSWORD not set, using default "mom123".')
            }
            if (!process.env.CASH_EMPLOYEE_PASSWORD) {
                console.warn('⚠️  WARNING: CASH_EMPLOYEE_PASSWORD not set, using default "1".')
            }

            // admin: mom
            let momUser = await prisma.user.findFirst({
                where: { username: momUsername, tenantId },
            })
            const momHashed = hashPassword(momPassword)
            if (momUser) {
                await prisma.user.update({
                    where: { id: momUser.id },
                    data: { password: momHashed, status: true, locationId: pingtungLocation.id },
                })
            } else {
                momUser = await prisma.user.create({
                    data: {
                        username: momUsername,
                        password: momHashed,
                        realName: '洪怜俼',
                        tenantId,
                        locationId: pingtungLocation.id,
                        status: true,
                    },
                })
            }
            await prisma.userRole.upsert({
                where: { userId_roleId: { userId: momUser.id, roleId: adminRole.id } },
                update: {},
                create: { userId: momUser.id, roleId: adminRole.id },
            })

            // 員工: 1
            let employeeUser = await prisma.user.findFirst({
                where: { username: employeeUsername, tenantId },
            })
            const empHashed = hashPassword(employeePassword)
            if (employeeUser) {
                await prisma.user.update({
                    where: { id: employeeUser.id },
                    data: { password: empHashed, status: true, locationId: pingtungLocation.id },
                })
            } else {
                employeeUser = await prisma.user.create({
                    data: {
                        username: employeeUsername,
                        password: empHashed,
                        realName: '清點員',
                        tenantId,
                        locationId: pingtungLocation.id,
                        status: true,
                    },
                })
            }
            await prisma.userRole.upsert({
                where: { userId_roleId: { userId: employeeUser.id, roleId: writeRole.id } },
                update: {},
                create: { userId: employeeUser.id, roleId: writeRole.id },
            })

            // 預設 checklist items
            const defaultChecklist = [
                { name: '瓦斯兩桶', sortOrder: 1 },
                { name: '錢盒櫃要上鎖', sortOrder: 2 },
            ]
            for (const item of defaultChecklist) {
                const existing = await prisma.checklistItem.findFirst({
                    where: { tenantId, name: item.name },
                })
                if (existing) {
                    await prisma.checklistItem.update({
                        where: { id: existing.id },
                        data: { sortOrder: item.sortOrder, isActive: true },
                    })
                } else {
                    await prisma.checklistItem.create({
                        data: { ...item, tenantId, isActive: true },
                    })
                }
            }
        } else {
            console.warn('⚠️  CashCount seed skipped: missing write role or 屏東攤位 location.')
        }
    }

    console.log('✅ Seed data initialized (multi-tenant)')
    console.log(`   Tenant: ${defaultTenant.name} (${defaultTenant.code})`)
    console.log(`   Super Admin: superadmin`)
    console.log(`   Tenant Admin: admin`)
    console.log(`   Cash admin: mom / Cash employee: 1`)
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })

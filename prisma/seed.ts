import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'

const prisma = new PrismaClient()

async function main() {
    // 1. 建立地點
    const locations = [
        { name: '屏東攤位' },
        { name: '潮州攤位' },
    ]

    for (const loc of locations) {
        await prisma.location.upsert({
            where: { name: loc.name },
            update: {},
            create: loc,
        })
    }

    // 2. 建立分類
    const categories = [
        { name: '肉類', sortOrder: 1 },
        { name: '菜類', sortOrder: 2 },
        { name: '其他', sortOrder: 99 },
    ]

    for (const cat of categories) {
        await prisma.category.upsert({
            where: { name: cat.name },
            update: {},
            create: cat,
        })
    }

    // 3. 建立品項清單
    const meatCat = await prisma.category.findUnique({ where: { name: '肉類' } })
    const vegCat = await prisma.category.findUnique({ where: { name: '菜類' } })
    const otherCat = await prisma.category.findUnique({ where: { name: '其他' } })

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
                where: { name_categoryId: { name: item.name, categoryId } },
                update: { defaultUnit, sortOrder: sortOffset + index + 1 },
                create: {
                    name: item.name,
                    categoryId,
                    defaultUnit,
                    sortOrder: sortOffset + index + 1,
                },
            })
        }
    }

    await upsertItems(meatCat?.id, meatItems)
    await upsertItems(vegCat?.id, vegetableItems)
    await upsertItems(otherCat?.id, processedItems)
    await upsertItems(otherCat?.id, dryGoods, processedItems.length)

    // 4. 建立 Dictionary (支出類型)
    const expenseTypes = [
        { label: '租金', value: 'rent' },
        { label: '水電費', value: 'utilities' },
        { label: '瓦斯', value: 'gas' },
        { label: '雜支', value: 'misc' },
    ]

    for (const exp of expenseTypes) {
        await prisma.dictionary.upsert({
            where: { category_value: { category: 'expense_type', value: exp.value } },
            update: {},
            create: { category: 'expense_type', label: exp.label, value: exp.value },
        })
    }

    // 5. 建立單位 (Dictionary: unit)
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
            where: { category_value: { category: 'unit', value: unit.value } },
            update: { label: unit.label, meta: JSON.stringify(unit.meta) },
            create: { category: 'unit', label: unit.label, value: unit.value, meta: JSON.stringify(unit.meta) },
        })
    }

    // 6. 建立預設角色
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

    // 7. 建立預設管理者帳號
    const adminRole = await prisma.role.findUnique({ where: { code: 'admin' } })
    if (adminRole) {
        const adminPassword = createHash('sha256').update('admin123').digest('hex')
        const admin = await prisma.user.upsert({
            where: { username: 'admin' },
            update: { status: true },
            create: {
                username: 'admin',
                password: adminPassword,
                realName: '系統管理者',
                status: true,
            },
        })

        await prisma.userRole.upsert({
            where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
            update: {},
            create: { userId: admin.id, roleId: adminRole.id },
        })
    }

    // 8. 建立預設唯讀帳號
    const readRole = await prisma.role.findUnique({ where: { code: 'read' } })
    if (readRole) {
        const viewerPassword = createHash('sha256').update('viewer123').digest('hex')
        const viewer = await prisma.user.upsert({
            where: { username: 'viewer' },
            update: { status: true },
            create: {
                username: 'viewer',
                password: viewerPassword,
                realName: '唯讀帳號',
                status: true,
            },
        })

        await prisma.userRole.upsert({
            where: { userId_roleId: { userId: viewer.id, roleId: readRole.id } },
            update: {},
            create: { userId: viewer.id, roleId: readRole.id },
        })
    }

    console.log('Seed data initialized')
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

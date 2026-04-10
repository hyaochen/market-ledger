import { PrismaClient } from './node_modules/.prisma/client/index.js';
const prisma = new PrismaClient({ datasources: { db: { url: 'file:./docker-data/dev.db?mode=ro' } } });
async function main() {
  const items = await prisma.item.findMany({ where: { isActive: true }, select: { name: true, defaultUnit: true }, orderBy: { sortOrder: 'asc' } });
  console.log('=== ITEMS (' + items.length + ') ===');
  items.forEach(i => console.log(i.name + ' | ' + i.defaultUnit));
  
  const vendors = await prisma.vendor.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: 'asc' } });
  console.log('\n=== VENDORS (' + vendors.length + ') ===');
  vendors.forEach(v => console.log(v.name));
  
  const expTypes = await prisma.dictionary.findMany({ where: { category: 'expense_type', isActive: true }, select: { label: true, value: true }, orderBy: { sortOrder: 'asc' } });
  console.log('\n=== EXPENSE TYPES (' + expTypes.length + ') ===');
  expTypes.forEach(e => console.log(e.value + ' ' + e.label));
  
  const units = await prisma.dictionary.findMany({ where: { category: 'unit', isActive: true }, select: { label: true, value: true, meta: true }, orderBy: { sortOrder: 'asc' } });
  console.log('\n=== UNITS (' + units.length + ') ===');
  units.forEach(u => console.log(u.value + ' ' + u.label + ' meta:' + u.meta));
  
  const locs = await prisma.location.findMany({ where: { isActive: true }, select: { name: true } });
  console.log('\n=== LOCATIONS (' + locs.length + ') ===');
  locs.forEach(l => console.log(l.name));
  
  const recentEntries = await prisma.entry.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { type: true, date: true, totalPrice: true, note: true, expenseType: true, inputQuantity: true, inputUnit: true, item: { select: { name: true } }, vendor: { select: { name: true } } } });
  console.log('\n=== RECENT ENTRIES (last 20) ===');
  recentEntries.forEach(e => {
    const d = new Date(e.date).toLocaleDateString('zh-TW');
    if (e.type === 'PURCHASE') console.log(d + ' PURCHASE ' + (e.item ? e.item.name : '?') + ' ' + (e.inputQuantity || '') + (e.inputUnit || '') + ' $' + e.totalPrice + (e.vendor ? ' ' + e.vendor.name : '') + (e.note ? ' 備註:' + e.note : ''));
    else console.log(d + ' EXPENSE ' + e.expenseType + ' $' + e.totalPrice + (e.note ? ' 備註:' + e.note : ''));
  });
}
main().finally(() => prisma.$disconnect());

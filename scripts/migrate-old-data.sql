-- 將舊資料庫掛載
ATTACH DATABASE 'prisma/dev_old_backup.db' AS old;

-- tenantId = cml8xdpx20000cfyo23pu6cbm (預設企業)

-- ============================================
-- 1. 清除 seed 產生的資料（保留 Tenant, super admin, roles）
-- ============================================
DELETE FROM main.UserRole WHERE userId = 'cml8xdq430041cfyoc1or7ebj';
DELETE FROM main.User WHERE id = 'cml8xdq430041cfyoc1or7ebj';
DELETE FROM main.Entry;
DELETE FROM main.Revenue;
DELETE FROM main.EntryTemplate;
DELETE FROM main.Item;
DELETE FROM main.Category;
DELETE FROM main.Vendor;
DELETE FROM main.Dictionary;
DELETE FROM main.Location;
DELETE FROM main.Region;
DELETE FROM main.Department;
DELETE FROM main.OperationLog;

-- ============================================
-- 2. 匯入使用者
-- ============================================
INSERT INTO main.User (id, username, password, realName, status, tenantId, isSuperAdmin, createdAt, updatedAt)
SELECT id, username, password, realName, status, 'cml8xdpx20000cfyo23pu6cbm', 0, createdAt, updatedAt
FROM old.User;

-- 匯入 UserRole (Role ID 可能不同，用 code 對應)
INSERT OR IGNORE INTO main.UserRole (userId, roleId)
SELECT ur.userId, mr.id
FROM old.UserRole ur
JOIN old.Role oRole ON oRole.id = ur.roleId
JOIN main.Role mr ON mr.code = oRole.code
WHERE EXISTS (SELECT 1 FROM main.User u WHERE u.id = ur.userId);

-- ============================================
-- 3. 匯入部門 (舊: status, 新: status)
-- ============================================
INSERT INTO main.Department (id, name, code, parentId, sortOrder, status, tenantId, createdAt, updatedAt)
SELECT id, name, code, parentId, sortOrder, status, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Department;

-- ============================================
-- 4. 匯入廠商
-- ============================================
INSERT INTO main.Vendor (id, name, contact, phone, note, isActive, tenantId, createdAt, updatedAt)
SELECT id, name, contact, phone, note, isActive, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Vendor;

-- ============================================
-- 5. 匯入品項類別 (沒有 isActive 欄位)
-- ============================================
INSERT INTO main.Category (id, name, sortOrder, tenantId, createdAt, updatedAt)
SELECT id, name, sortOrder, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Category;

-- ============================================
-- 6. 匯入品項
-- ============================================
INSERT INTO main.Item (id, name, categoryId, defaultUnit, sortOrder, isActive, tenantId, createdAt, updatedAt)
SELECT id, name, categoryId, defaultUnit, sortOrder, isActive, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Item;

-- ============================================
-- 7. 匯入區域 (舊有 type/parentId，新的是扁平結構)
-- ============================================
INSERT INTO main.Region (id, name, code, sortOrder, isActive, tenantId, createdAt, updatedAt)
SELECT id, name, code, 0, 1, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Region;

-- ============================================
-- 8. 匯入場所 (新增 regionId 關聯到第一個區域)
-- ============================================
INSERT INTO main.Location (id, name, isActive, tenantId, regionId, createdAt, updatedAt)
SELECT
    l.id, l.name, l.isActive, 'cml8xdpx20000cfyo23pu6cbm',
    (SELECT id FROM old.Region LIMIT 1),
    l.createdAt, l.updatedAt
FROM old.Location l;

-- ============================================
-- 9. 匯入字典
-- ============================================
INSERT INTO main.Dictionary (id, category, label, value, meta, sortOrder, isActive, tenantId, createdAt, updatedAt)
SELECT id, category, label, value, meta, sortOrder, isActive, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Dictionary;

-- ============================================
-- 10. 匯入營收
-- ============================================
INSERT INTO main.Revenue (id, date, locationId, amount, isDayOff, note, tenantId, createdAt, updatedAt)
SELECT id, date, locationId, amount, isDayOff, note, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Revenue;

-- ============================================
-- 11. 匯入進貨/支出記錄
-- ============================================
INSERT INTO main.Entry (id, date, type, status, itemId, vendorId, inputQuantity, inputUnit, standardWeight, unitPrice, totalPrice, note, expenseType, userId, tenantId, createdAt, updatedAt)
SELECT id, date, type, status, itemId, vendorId, inputQuantity, inputUnit, standardWeight, unitPrice, totalPrice, note, expenseType, userId, 'cml8xdpx20000cfyo23pu6cbm', createdAt, updatedAt
FROM old.Entry;

-- ============================================
-- 12. 匯入操作日誌
-- ============================================
INSERT INTO main.OperationLog (id, userId, action, module, target, details, ip, status, duration, tenantId, createdAt)
SELECT id, userId, action, module, target, details, ip, status, duration, 'cml8xdpx20000cfyo23pu6cbm', createdAt
FROM old.OperationLog;

-- ============================================
-- 13. 匯入模板
-- ============================================
INSERT OR IGNORE INTO main.EntryTemplate (id, name, type, itemId, vendorId, inputQuantity, inputUnit, expenseType, unitPrice, totalPrice, note, userId, tenantId, sortOrder, createdAt, updatedAt)
SELECT id, name, type, itemId, vendorId, inputQuantity, inputUnit, expenseType, unitPrice, totalPrice, note, userId, 'cml8xdpx20000cfyo23pu6cbm', sortOrder, createdAt, updatedAt
FROM old.EntryTemplate;

DETACH DATABASE old;

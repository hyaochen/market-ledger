// 使用者別名快取：記住「肝連」→「肝蓮」這類習慣性錯字對照
// 儲存於 /app/data/aliases-{tenantId}.json（與 DB 同目錄，持久化）

import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.BOT_DATA_DIR ?? '/app/data';

export type AliasEntry = { itemId: string; itemName: string };
export type AliasMap = Record<string, AliasEntry>;

function aliasFilePath(tenantId: string): string {
    return path.join(DATA_DIR, `aliases-${tenantId}.json`);
}

export function loadAliases(tenantId: string): AliasMap {
    try {
        const fp = aliasFilePath(tenantId);
        if (!fs.existsSync(fp)) return {};
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
        return {};
    }
}

export function saveAlias(
    tenantId: string,
    originalName: string,
    itemId: string,
    itemName: string,
): void {
    if (!originalName || originalName === itemName) return; // 不存完全相同的名稱
    const aliases = loadAliases(tenantId);
    aliases[originalName] = { itemId, itemName };
    try {
        fs.writeFileSync(aliasFilePath(tenantId), JSON.stringify(aliases, null, 2), 'utf8');
        console.log(`[Alias] Saved: "${originalName}" → "${itemName}"`);
    } catch (e) {
        console.error('[Alias] Failed to save:', e);
    }
}

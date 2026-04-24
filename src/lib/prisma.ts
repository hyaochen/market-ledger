import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
    const client = new PrismaClient();
    // SQLite WAL mode：允許讀寫並發（web + bot 同時寫不再鎖表）
    // synchronous=NORMAL：在 WAL 模式下與 FULL 同樣耐 crash，但寫入更快
    client.$executeRawUnsafe('PRAGMA journal_mode=WAL;')
        .then(() => client.$executeRawUnsafe('PRAGMA synchronous=NORMAL;'))
        .catch((err) => {
            console.warn('[prisma] could not set SQLite pragmas (non-fatal):', err?.message ?? err);
        });
    return client;
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

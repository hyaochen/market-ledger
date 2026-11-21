// 密碼驗證的全域併發閘門（單一 process 內的簡單 semaphore）。
// bcrypt（cost 12，bcryptjs 在主執行緒分段執行）同時跑太多會吃滿 CPU：
// 同時最多 maxConcurrent 個在跑，排隊超過 maxWaiting 個就直接拒絕（busy），不執行。

export const BCRYPT_MAX_CONCURRENT = 4;
export const BCRYPT_MAX_WAITING = 20;

export type GateResult<T> = { busy: true } | { busy: false; value: T };

export function createGate(maxConcurrent: number, maxWaiting: number) {
    let running = 0;
    const waiters: Array<() => void> = [];

    function release() {
        const next = waiters.shift();
        if (next) next(); // 把名額直接交給下一個等待者（running 不變）
        else running -= 1;
    }

    async function run<T>(fn: () => Promise<T>): Promise<GateResult<T>> {
        if (running < maxConcurrent) {
            running += 1;
        } else if (waiters.length >= maxWaiting) {
            return { busy: true };
        } else {
            await new Promise<void>((resolve) => waiters.push(resolve));
        }
        try {
            return { busy: false, value: await fn() };
        } finally {
            release();
        }
    }

    return { run, stats: () => ({ running, waiting: waiters.length }) };
}

export const passwordGate = createGate(BCRYPT_MAX_CONCURRENT, BCRYPT_MAX_WAITING);

/**
 * 邊串流邊計 byte 讀取 request body 成字串；超過 maxBytes 立刻中止並回 "too_large"。
 * 不信任 Content-Length（可能被省略或造假）。
 */
export async function readBodyCapped(req: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<string | "too_large"> {
    if (!req.body) return "";
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return "too_large";
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString("utf8");
}

import test from "node:test";
import assert from "node:assert/strict";
import { readBodyCapped } from "./read-body-capped";

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const p of parts) controller.enqueue(enc.encode(p));
            controller.close();
        },
    });
}

test("上限內的 body 完整讀回（含中文跨 chunk）", async () => {
    const out = await readBodyCapped({ body: streamOf(['{"名稱":"滷', '豬耳"}']) }, 1024);
    assert.equal(out, '{"名稱":"滷豬耳"}');
});

test("超過上限就中止回 too_large（即使沒有 Content-Length）", async () => {
    const out = await readBodyCapped({ body: streamOf(["12345", "67890", "abcde"]) }, 12);
    assert.equal(out, "too_large");
});

test("剛好等於上限允許", async () => {
    assert.equal(await readBodyCapped({ body: streamOf(["12345"]) }, 5), "12345");
});

test("沒有 body 回空字串", async () => {
    assert.equal(await readBodyCapped({ body: null }, 5), "");
});

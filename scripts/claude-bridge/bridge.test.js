'use strict';
// T-ML-037 self-check for the bridge auth / Origin / model-allowlist logic.
// Run: node --test scripts/claude-bridge/bridge.test.js   (also part of `npm run test`)
// Never spawns claude: every request below is rejected before the subprocess stage.
process.env.CLAUDE_BRIDGE_TOKEN = 'test-token-0123456789';
process.env.CLAUDE_BRIDGE_BIN = process.execPath; // avoid the claude.cmd lookup path
process.env.CLAUDE_BRIDGE_PORT = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bridge = require('./bridge.js');

const TOKEN = 'test-token-0123456789';
const req = (headers) => ({ headers });

test('checkRequestAuth: Origin header is always rejected', () => {
    const r = bridge.checkRequestAuth(req({ origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` }), TOKEN);
    assert.equal(r.status, 403);
    assert.equal(bridge.checkRequestAuth(req({ origin: 'null' }), '').status, 403);
});

test('checkRequestAuth: token required when configured', () => {
    assert.equal(bridge.checkRequestAuth(req({}), TOKEN).status, 401);
    assert.equal(bridge.checkRequestAuth(req({ authorization: 'Bearer wrong' }), TOKEN).status, 401);
    assert.equal(bridge.checkRequestAuth(req({ authorization: TOKEN }), TOKEN).status, 401);
    assert.equal(bridge.checkRequestAuth(req({ authorization: `Bearer ${TOKEN}` }), TOKEN), null);
});

test('checkRequestAuth: no token configured -> only Origin check applies', () => {
    assert.equal(bridge.checkRequestAuth(req({}), ''), null);
});

test('tokensEqual handles different lengths without throwing', () => {
    assert.equal(bridge.tokensEqual('a', 'abcdef'), false);
    assert.equal(bridge.tokensEqual('abcdef', 'abcdef'), true);
});

test('model allowlist', () => {
    assert.ok(bridge.ALLOWED_MODELS.has('sonnet'));
    assert.ok(!bridge.ALLOWED_MODELS.has('--dangerously-skip-permissions'));
});

function call(port, { method = 'POST', url = '/chat', headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

test('HTTP: /chat auth, Origin, model and /health behaviour', async () => {
    await new Promise((res) => bridge.server.listen(0, '127.0.0.1', res));
    const port = bridge.server.address().port;
    try {
        const ok = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
        const body = (o) => JSON.stringify(o);

        assert.equal((await call(port, { headers: { 'Content-Type': 'application/json' }, body: body({ user: 'x' }) })).status, 401);
        assert.equal((await call(port, { headers: { ...ok, Origin: 'http://evil.example' }, body: body({ user: 'x' }) })).status, 403);
        assert.equal((await call(port, { headers: ok, body: body({ user: 'x', model: 'evil-model' }) })).status, 400);
        assert.equal((await call(port, { headers: ok, body: body({}) })).status, 400); // missing user
        assert.equal((await call(port, { method: 'GET', url: '/health', headers: {} })).status, 200);
        assert.equal((await call(port, { method: 'GET', url: '/health', headers: { Origin: 'http://evil.example' } })).status, 403);
    } finally {
        await new Promise((res) => bridge.server.close(res));
    }
});

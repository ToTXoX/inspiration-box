const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const frontend = path.resolve(__dirname, '../inspiration-box');
const { transformSync } = createRequire(path.join(frontend, 'package.json'))('esbuild');
const source = transformSync(fs.readFileSync(path.join(frontend, 'src/lib/desktop.ts'), 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'es2020'
}).code;
const writes = [];
const responses = [];
const statuses = [];
const browserStorage = new Map();
const window = {
  webkit: { messageHandlers: { inspiration: { postMessage: (body) => {
    if (body.method === 'writeState') {
      writes.push(body.value);
      return new Promise((resolve, reject) => responses.push({ resolve, reject }));
    }
    throw new Error('Unexpected native call');
  } } } },
  dispatchEvent: event => statuses.push(event.detail)
};
const moduleObject = { exports: {} };
vm.runInNewContext(source, { module: moduleObject, exports: moduleObject.exports, window,
  URL, setTimeout, clearTimeout, CustomEvent: class { constructor(name, options) { this.detail = options.detail; } },
  localStorage: { getItem: key => browserStorage.get(key) ?? null, setItem: (key, value) => browserStorage.set(key, value), removeItem: key => browserStorage.delete(key) }
});
const { extractSharedURL, appStorage, flushDesktopState } = moduleObject.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  assert.equal(extractSharedURL('一年级备课 https://www.xiaohongshu.com/explore/id?xsec_token=a%2Bb%3D&xsec_source=pc_share ，复制打开'),
    'https://www.xiaohongshu.com/explore/id?xsec_token=a%2Bb%3D&xsec_source=pc_share');
  assert.equal(extractSharedURL(' https://example.com/note?a=1\\&b=2 '), 'https://example.com/note?a=1&b=2');
  assert.equal(extractSharedURL('没有网址'), null);
  console.log('PASS: sharing text extraction and query preservation');

  appStorage.setItem('state', 'first');
  const first = flushDesktopState();
  appStorage.setItem('state', 'second');
  const second = flushDesktopState();
  assert.deepEqual(writes, ['first']);
  responses.shift().resolve(true);
  await tick();
  assert.deepEqual(writes, ['first', 'second']);
  responses.shift().resolve(true);
  await Promise.all([first, second]);
  console.log('PASS: concurrent flushes serialize writes and retain newest state');

  appStorage.setItem('state', 'retry-state');
  const failed = flushDesktopState();
  responses.shift().reject(new Error('disk unavailable'));
  await assert.rejects(failed, /disk unavailable/);
  assert.equal(statuses.at(-1), 'disk unavailable');
  const retry = flushDesktopState();
  assert.equal(writes.at(-1), 'retry-state');
  responses.shift().resolve(true);
  await retry;
  assert.equal(statuses.at(-1), null);
  console.log('PASS: failed saves remain retryable');

  window.webkit = undefined;
  appStorage.setItem('state', 'browser');
  assert.equal(appStorage.getItem('state'), 'browser');
  console.log('PASS: browser development storage remains independent');
})().catch(error => { console.error(error); process.exitCode = 1; });

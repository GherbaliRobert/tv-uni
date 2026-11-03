const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createLiveStream } = require('../src/live');

async function withStream(heartbeatMs, run) {
  const listeners = new Set();
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const app = express();
  app.get('/live', createLiveStream(subscribe, heartbeatMs));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/live`, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const nextChunk = async () => decoder.decode((await reader.read()).value);
  try {
    await run({ response, listeners, nextChunk, disconnect: () => controller.abort() });
  } finally {
    controller.abort();
    server.closeAllConnections();
    server.close();
  }
}

const until = async (condition) => {
  for (let i = 0; i < 100 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

test('a monitor is told about a change right away, in the format a browser expects', () => withStream(60000, async ({ response, listeners, nextChunk }) => {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(await nextChunk(), /^retry: \d+\n\n$/);

  await until(() => listeners.size === 1);
  listeners.forEach((notify) => notify());
  assert.equal(await nextChunk(), 'data: schimbare\n\n');
}));

test('a quiet connection is kept alive with pings that are not changes', () => withStream(20, async ({ nextChunk }) => {
  await nextChunk();
  assert.equal(await nextChunk(), ': ping\n\n');
}));

test('a monitor that leaves stops being notified', () => withStream(60000, async ({ listeners, nextChunk, disconnect }) => {
  await nextChunk();
  await until(() => listeners.size === 1);
  assert.equal(listeners.size, 1);
  disconnect();
  await until(() => listeners.size === 0);
  assert.equal(listeners.size, 0);
}));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const CLI = new URL('../tatemae.js', import.meta.url).pathname;
const run = promisify(execFile);

async function board(rows) {
  const srv = http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(rows)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const { stdout } = await run('node', [CLI, 'board', '--json'], { env: { ...process.env, TATEMAE_BOARD: `http://127.0.0.1:${srv.address().port}/` }, encoding: 'utf8' });
    return stdout;
  } finally { srv.close(); }
}

test('board --json prints only unjudged rows, unmodified, as one array', async () => {
  const open = { id: 'open1', verified: 'red', judged: false, f: { kind: 'bug', location: { path: 'a.js' }, defect: 'd' }, bounty: { title: 'Piece' } };
  const done = { id: 'done1', judged: true, f: { kind: 'bug', location: { path: 'x.js' }, defect: 'old' } };
  assert.deepEqual(JSON.parse(await board([open, done])), [open]);
});

test('board --json prints an empty array when nothing is open', async () => {
  assert.deepEqual(JSON.parse(await board([{ id: 'done1', judged: true }])), []);
});

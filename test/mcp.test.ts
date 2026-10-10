import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function connect(dataDir: string, readOnly = false) {
  const client = new Client({ name: 'inventory-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('dist/cli.js'), 'serve', '--data-dir', dataDir, ...(readOnly ? ['--read-only'] : [])],
    stderr: 'pipe',
  });
  await client.connect(transport);
  return client;
}

test('real stdio: discover, save, search, read, update, reject stale edit, reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'technique-mcp-test-'));
  const client = await connect(dir);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['add_technique', 'get_technique', 'inventory_stats', 'search_techniques', 'update_technique'].sort());
    const added = await client.callTool({ name: 'add_technique', arguments: {
      id: 'exact-witness-replay', title: 'Exact witness replay', summary: 'Check numerical proposals with rational arithmetic.',
      content: 'Construct a rational witness and check its inequality exactly.', tags: ['certificates'], project: 'test',
      limitations: 'Certifies only the checked inequality.', evidence: { level: 'experimental', details: 'Unit example only.' },
      sources: [{ note: 'Integration test fixture' }],
    } });
    assert.equal(added.isError, undefined, JSON.stringify(added));
    const saved = (added.structuredContent as any).technique;
    assert.equal(saved.revision, 1);
    const search = await client.callTool({ name: 'search_techniques', arguments: { query: 'rational', tags: ['certificates'] } });
    assert.equal((search.structuredContent as any).items[0].id, saved.id);
    const full = await client.callTool({ name: 'get_technique', arguments: { id: saved.id } });
    assert.equal((full.structuredContent as any).technique.limitations, 'Certifies only the checked inequality.');
    const updated = await client.callTool({ name: 'update_technique', arguments: { id: saved.id, expectedRevision: 1, patch: { nextSteps: 'Try another inequality.' } } });
    assert.equal((updated.structuredContent as any).technique.revision, 2);
    const conflict = await client.callTool({ name: 'update_technique', arguments: { id: saved.id, expectedRevision: 1, patch: { title: 'Stale overwrite' } } });
    assert.equal(conflict.isError, true);
    assert.equal((conflict.structuredContent as any).error, 'CONFLICT');
    const resource = await client.readResource({ uri: `techniques://record/${saved.id}` });
    assert.match((resource.contents[0] as any).text, /Try another inequality/);
    const schema = await client.readResource({ uri: 'techniques://schema' });
    assert.match((schema.contents[0] as any).text, /limitations/);
    const prompt = await client.getPrompt({ name: 'capture_technique', arguments: { finding: 'A scoped result.' } });
    assert.match((prompt.messages[0].content as any).text, /Search the inventory/);
    await client.close();
    const second = await connect(dir, true);
    try {
      assert.equal((await second.listTools()).tools.length, 3);
      const persisted = await second.callTool({ name: 'get_technique', arguments: { id: saved.id } });
      assert.equal((persisted.structuredContent as any).technique.revision, 2);
      const missing = await second.callTool({ name: 'get_technique', arguments: { id: 'unknown' } });
      assert.equal(missing.isError, true);
      assert.equal((missing.structuredContent as any).error, 'NOT_FOUND');
    } finally { await second.close(); }
  } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
});

test('two stdio clients serialize edits to the same inventory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'technique-mcp-concurrent-'));
  const first = await connect(dir);
  const second = await connect(dir);
  try {
    await first.callTool({ name: 'add_technique', arguments: { id: 'shared', title: 'Shared record', summary: 'Concurrency test.', content: 'Original.' } });
    const responses = await Promise.all([first, second].map((client, i) => client.callTool({ name: 'update_technique', arguments: { id: 'shared', expectedRevision: 1, patch: { content: `Revision from client ${i}` } } })));
    assert.equal(responses.filter(response => response.isError).length, 1);
    assert.equal(responses.filter(response => !response.isError).length, 1);
    const final = await second.callTool({ name: 'get_technique', arguments: { id: 'shared' } });
    assert.equal((final.structuredContent as any).technique.revision, 2);
  } finally { await Promise.all([first.close(), second.close()]); await rm(dir, { recursive: true, force: true }); }
});

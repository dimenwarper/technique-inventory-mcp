#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { InventoryStore } from './store.js';
import { createServer, VERSION } from './server.js';

const help = `technique-inventory-mcp ${VERSION}

Usage:
  technique-inventory-mcp serve --data-dir PATH [--read-only]
  technique-inventory-mcp validate --data-dir PATH
  technique-inventory-mcp stats --data-dir PATH

PATH contains techniques/*.json. INVENTORY_DIR can supply the path instead.
The MCP host launches 'serve'; stdout is reserved for the protocol.
Use the same absolute path in every client to share one cross-project inventory.
`;

async function main() {
  const { values, positionals } = parseArgs({ options: {
    'data-dir': { type: 'string' },
    'read-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  }, allowPositionals: true, strict: true });
  if (values.help) { console.log(help); return; }
  if (values.version) { console.log(VERSION); return; }
  const command = positionals[0] ?? 'serve';
  if (positionals.length > 1 || !['serve', 'validate', 'stats'].includes(command)) {
    throw new Error('Expected one command: serve, validate, or stats. Use --help.');
  }
  const dataDir = values['data-dir'] || process.env.INVENTORY_DIR;
  if (!dataDir) throw new Error('Provide --data-dir PATH or INVENTORY_DIR. No inventory location is guessed.');
  const store = new InventoryStore(resolve(dataDir));
  await store.init();
  if (command === 'validate') {
    const records = await store.listAll();
    const ids = new Set(records.map(record => record.id));
    const unresolvedRelations = records.flatMap(record => record.relatedIds.filter(id => !ids.has(id)).map(id => ({ record: record.id, missing: id })));
    console.log(JSON.stringify({ valid: true, records: records.length, unresolvedRelations }, null, 2));
    return;
  }
  if (command === 'stats') { console.log(JSON.stringify(await store.stats(), null, 2)); return; }
  const server = createServer(store, { readOnly: values['read-only'] });
  const transport = new StdioServerTransport();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
  };
  process.once('SIGINT', () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
  await server.connect(transport);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

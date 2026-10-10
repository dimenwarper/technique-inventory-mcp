import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { InventoryError, InventoryStore } from '../src/store.js';
import { techniqueCreateSchema, techniquePatchSchema, type TechniqueCreate } from '../src/schema.js';

const execute = promisify(execFile);
const sample = (id: string, extra: Partial<TechniqueCreate> = {}): TechniqueCreate => ({
  id, title: 'Exact certificate replay', summary: 'Turn numerical discovery into an exact proof.',
  content: 'Replay each rational step with a small independent verifier.', ...extra,
});
const hasCode = (code: string) => (error: unknown) => error instanceof InventoryError && error.code === code;

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const path = await mkdtemp(join(tmpdir(), 'technique-store-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const store = new InventoryStore(join(path, 'inventory'));
  await store.init();
  return { path, store };
}

test('records persist as readable JSON with defaults and optimistic revisions', async t => {
  const { store } = await fixture(t);
  const created = await store.create(sample('exact-replay', { tags: ['proof', 'proof'] }));
  assert.equal(created.revision, 1);
  assert.equal(created.status, 'active');
  assert.deepEqual(created.evidence, { level: 'unassessed', details: '' });
  assert.deepEqual(created.tags, ['proof']);
  const raw = await readFile(join(store.techniquesDir, 'exact-replay.json'), 'utf8');
  assert.ok(raw.startsWith('{\n  "title":'));
  assert.ok(raw.endsWith('\n'));
  assert.deepEqual(await new InventoryStore(store.dataDir).get(created.id), created);
  const updated = await store.update(created.id, 1, { limitations: 'Requires rational input.' });
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.limitations, 'Requires rational input.');
  await assert.rejects(store.update(created.id, 1, { summary: 'Stale edit.' }), hasCode('CONFLICT'));
  await assert.rejects(store.create(sample(created.id)), hasCode('CONFLICT'));
  assert.equal((await store.get(created.id)).summary, created.summary);
});

test('generated IDs are safe, deterministic, and require explicit collision resolution', async t => {
  const { store } = await fixture(t);
  const input = { title: 'Café: Exact / Proof', summary: 'A summary.', content: 'Details.' };
  assert.equal((await store.create(input)).id, 'cafe-exact-proof');
  await assert.rejects(store.create(input), hasCode('CONFLICT'));
});

test('search ranks title matches, uses AND filters, excludes archived, and paginates deterministically', async t => {
  const { store } = await fixture(t);
  await store.create(sample('a-title', { title: 'Quadratic phase', tags: ['algebra', 'exact'], project: 'ETH', evidence: { level: 'proof' } }));
  await store.create(sample('b-content', { content: 'Computes a quadratic phase.', tags: ['algebra'], project: 'Other' }));
  await store.create(sample('c-archived', { title: 'Quadratic phase', status: 'archived' }));
  await store.create(sample('d-unrelated', { title: 'A distinct method', content: 'Approximate algorithm.' }));
  const search = await store.search({ query: 'quadratic phase' });
  assert.deepEqual(search.items.map(item => item.id), ['a-title', 'b-content']);
  assert.ok(search.items[0]!.score > search.items[1]!.score);
  assert.equal(search.items[0]!.evidenceLevel, 'proof');
  assert.deepEqual((await store.search({ tags: ['ALGEBRA', 'exact'], project: 'eth', evidenceLevel: 'proof' })).items.map(item => item.id), ['a-title']);
  assert.equal((await store.search({ query: 'quadratic missing' })).total, 0);
  assert.deepEqual((await store.search({ status: 'archived' })).items.map(item => item.id), ['c-archived']);
  const page = await store.search({ limit: 1, offset: 1 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.map(item => item.id), ['b-content']);
  assert.equal((await store.search({ tags: [] })).total, 3);
  assert.equal((await store.stats()).total, 4);
  assert.equal((await store.stats()).byTag.algebra, 2);
});

test('strict schemas reject unknown fields, empty patches, invalid evidence, and unsafe IDs', async t => {
  const { store, path } = await fixture(t);
  assert.equal(techniqueCreateSchema.safeParse({ ...sample('valid'), surprise: true }).success, false);
  assert.equal(techniquePatchSchema.safeParse({ revision: 20 }).success, false);
  assert.equal(techniquePatchSchema.safeParse({}).success, false);
  assert.equal(techniqueCreateSchema.safeParse(sample('valid', { evidence: { level: 'experimental', verifiedAt: 'yesterday' } })).success, false);
  assert.equal(techniqueCreateSchema.safeParse(sample('valid', { sources: [{ url: 'file:///private/file' }] })).success, false);
  assert.equal(techniqueCreateSchema.safeParse(sample('valid', { sources: [{}] })).success, false);
  for (const id of ['../outside', '/tmp/escape', 'MixedCase', 'two--hyphens', '.hidden', 'a'.repeat(97)]) {
    await assert.rejects(store.create(sample(id)), hasCode('INVALID_DATA'));
    await assert.rejects(store.get(id), hasCode('INVALID_DATA'));
  }
  await assert.rejects(readFile(join(path, 'outside.json')), { code: 'ENOENT' });
  await assert.rejects(store.get('missing'), hasCode('NOT_FOUND'));
});

test('malformed records and mismatched IDs fail loudly, including in search', async t => {
  const { store } = await fixture(t);
  await writeFile(join(store.techniquesDir, 'broken.json'), '{oops');
  await assert.rejects(store.search(), error => hasCode('INVALID_DATA')(error) && String(error).includes('broken.json'));
  await rm(join(store.techniquesDir, 'broken.json'));
  const record = await store.create(sample('good'));
  await writeFile(join(store.techniquesDir, 'wrong-id.json'), JSON.stringify(record));
  await assert.rejects(store.listAll(), error => hasCode('INVALID_DATA')(error) && String(error).includes('does not match'));
});

test('symlink roots, record directories, and records are refused without writing outside the inventory', async t => {
  const { store, path } = await fixture(t);
  const outside = join(path, 'outside');
  await mkdir(outside);
  const rootLink = join(path, 'root-link');
  await symlink(outside, rootLink);
  await assert.rejects(new InventoryStore(rootLink).init(), hasCode('UNSAFE_PATH'));
  await symlink(join(outside, 'record.json'), join(store.techniquesDir, 'linked.json'));
  await assert.rejects(store.get('linked'), hasCode('UNSAFE_PATH'));
  await assert.rejects(store.create(sample('linked')), hasCode('UNSAFE_PATH'));
  await assert.rejects(store.listAll(), hasCode('UNSAFE_PATH'));
  await rm(join(store.techniquesDir, 'linked.json'));
  await rm(store.techniquesDir, { recursive: true });
  await symlink(outside, store.techniquesDir);
  await assert.rejects(store.create(sample('unsafe')), hasCode('UNSAFE_PATH'));
  await assert.rejects(readFile(join(outside, 'unsafe.json')), { code: 'ENOENT' });
});

test('same-process simultaneous writers cannot overwrite a create or lose updates', async t => {
  const { store } = await fixture(t);
  const creates = await Promise.allSettled(Array.from({ length: 6 }, () => new InventoryStore(store.dataDir).create(sample('race'))));
  assert.equal(creates.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of creates) if (result.status === 'rejected') assert.ok(hasCode('CONFLICT')(result.reason));
  const updates = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => new InventoryStore(store.dataDir).update('race', 1, { content: `Writer ${i}` })));
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of updates) if (result.status === 'rejected') assert.ok(hasCode('CONFLICT')(result.reason));
  assert.equal((await store.get('race')).revision, 2);
});

test('independent processes share the lock for same-ID creates and revision updates', async t => {
  const { store } = await fixture(t);
  const storeModule = new URL('../src/store.ts', import.meta.url).href;
  const run = async (action: 'create' | 'update', index: number) => {
    const script = `
      import { InventoryStore } from ${JSON.stringify(storeModule)};
      const store = new InventoryStore(process.argv[1]);
      try {
        const record = process.argv[2] === 'create'
          ? await store.create({ id: 'process-race', title: 'Process race', summary: 'Summary', content: process.argv[3] })
          : await store.update('process-race', 1, { content: process.argv[3] });
        process.stdout.write(JSON.stringify({ revision: record.revision }));
      } catch (error) { process.stdout.write(JSON.stringify({ code: error.code })); }
    `;
    const { stdout } = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, store.dataDir, action, String(index)], { cwd: new URL('..', import.meta.url) });
    return JSON.parse(stdout) as { revision?: number; code?: string };
  };
  const creates = await Promise.all([run('create', 0), run('create', 1), run('create', 2)]);
  assert.equal(creates.filter(result => result.revision === 1).length, 1);
  assert.equal(creates.filter(result => result.code === 'CONFLICT').length, 2);
  const updates = await Promise.all([run('update', 0), run('update', 1), run('update', 2)]);
  assert.equal(updates.filter(result => result.revision === 2).length, 1);
  assert.equal(updates.filter(result => result.code === 'CONFLICT').length, 2);
  assert.equal((await store.get('process-race')).revision, 2);
});

test('import preserves metadata, is repeatable, and preflights all conflicts', async t => {
  const { store, path } = await fixture(t);
  const source = new InventoryStore(join(path, 'source'));
  const first = await source.create(sample('first'));
  const second = await source.create(sample('second'));
  const oldTime = '2020-01-02T03:04:05Z';
  first.createdAt = oldTime; first.updatedAt = oldTime; first.revision = 4;
  assert.deepEqual(await store.importRecords([first]), { created: ['first'], skipped: [] });
  assert.equal((await store.get('first')).revision, 4);
  assert.equal((await store.get('first')).createdAt, oldTime);
  assert.deepEqual(await store.importRecords([{ ...first, revision: 1 }]), { created: [], skipped: ['first'] });
  await assert.rejects(store.importRecords([second, { ...first, summary: 'A conflicting description.' }]), hasCode('CONFLICT'));
  await assert.rejects(store.get('second'), hasCode('NOT_FOUND'));
  await assert.rejects(store.importRecords([second, second]), hasCode('INVALID_DATA'));
});

test('stats safely handle arbitrary tag and project names', async t => {
  const { store } = await fixture(t);
  await store.create(sample('prototype-names', { tags: ['__proto__', 'constructor'], project: '__proto__' }));
  const stats = await store.stats();
  assert.equal(stats.byTag.__proto__, 1);
  assert.equal(stats.byTag.constructor, 1);
  assert.equal(stats.byProject.__proto__, 1);
});

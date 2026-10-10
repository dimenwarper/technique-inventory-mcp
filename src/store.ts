import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  evidenceLevelSchema, kindSchema, statusSchema, techniqueCreateSchema,
  techniqueIdSchema, techniquePatchSchema, techniqueSchema,
  type Technique, type TechniqueCreate, type TechniquePatch,
} from './schema.js';

export type InventoryErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INVALID_DATA' | 'UNSAFE_PATH' | 'LOCK_TIMEOUT';
export class InventoryError extends Error {
  constructor(public readonly code: InventoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InventoryError';
  }
}

export const searchSchema = z.strictObject({
  query: z.string().default(''),
  tags: z.array(z.string().min(1)).default([]),
  project: z.string().optional(),
  kind: kindSchema.optional(),
  evidenceLevel: evidenceLevelSchema.optional(),
  status: statusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type SearchOptions = z.input<typeof searchSchema>;
export type SearchItem = Pick<Technique, 'id' | 'title' | 'summary' | 'tags' | 'project' | 'kind' | 'status' | 'revision'> & {
  evidenceLevel: Technique['evidence']['level']; score: number;
};

const isFsError = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

function parse<T>(schema: z.ZodType<T>, input: unknown, context: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InventoryError('INVALID_DATA', `${context}: ${result.error.message}`);
  return result.data;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
function tokens(value: string): string[] {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}
function slug(title: string): string {
  return normalize(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96).replace(/-$/, '') || `technique-${randomUUID()}`;
}

/** A Git-friendly inventory. Each complete JSON record is its own transaction. */
export class InventoryStore {
  readonly dataDir: string;
  readonly techniquesDir: string;
  private readonly lockDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.techniquesDir = join(this.dataDir, 'techniques');
    this.lockDir = join(this.dataDir, '.write-lock');
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.assertDirectory(this.dataDir);
    await mkdir(this.techniquesDir, { recursive: true });
    await this.assertDirectory(this.techniquesDir);
  }

  private async assertDirectory(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new InventoryError('UNSAFE_PATH', `Expected a real directory, not a symlink: ${path}`);
    }
  }

  private async checkDirectories(): Promise<void> {
    await this.assertDirectory(this.dataDir);
    await this.assertDirectory(this.techniquesDir);
  }

  private recordPath(id: string): string {
    parse(techniqueIdSchema, id, 'Invalid technique ID');
    return join(this.techniquesDir, `${id}.json`);
  }

  private async readRecord(id: string): Promise<Technique> {
    const path = this.recordPath(id);
    let handle;
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new InventoryError('UNSAFE_PATH', `Expected a regular record file, not a symlink: ${path}`);
      }
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const data: unknown = JSON.parse(await handle.readFile('utf8'));
      const record = parse(techniqueSchema, data, `Invalid record ${path}`);
      if (record.id !== id) throw new InventoryError('INVALID_DATA', `Record ID ${record.id} does not match filename ${path}.`);
      return record;
    } catch (error) {
      if (error instanceof InventoryError) throw error;
      if (isFsError(error, 'ENOENT')) throw new InventoryError('NOT_FOUND', `Technique '${id}' does not exist.`, { cause: error });
      if (isFsError(error, 'ELOOP')) throw new InventoryError('UNSAFE_PATH', `Refusing symlink at ${path}.`, { cause: error });
      throw new InventoryError('INVALID_DATA', `Cannot read record ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      await handle?.close();
    }
  }

  async get(id: string): Promise<Technique> {
    this.recordPath(id);
    await this.init();
    await this.checkDirectories();
    return this.readRecord(id);
  }

  async listAll(): Promise<Technique[]> {
    await this.init();
    await this.checkDirectories();
    const entries = await readdir(this.techniquesDir, { withFileTypes: true });
    const records: Technique[] = [];
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.isSymbolicLink()) throw new InventoryError('UNSAFE_PATH', `Refusing symlink in inventory: ${join(this.techniquesDir, entry.name)}`);
      if (!entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      parse(techniqueIdSchema, id, `Invalid record filename ${join(this.techniquesDir, entry.name)}`);
      records.push(await this.readRecord(id));
    }
    return records;
  }

  private async withWriteLock<T>(work: () => Promise<T>): Promise<T> {
    await this.init();
    const start = Date.now();
    const ownerPath = join(this.lockDir, 'owner.json');
    for (;;) {
      await this.checkDirectories();
      try {
        await mkdir(this.lockDir, { mode: 0o700 });
        break;
      } catch (error) {
        if (!isFsError(error, 'EEXIST')) throw error;
        try { await this.assertDirectory(this.lockDir); }
        catch (lockError) {
          // The previous writer may release its lock immediately after mkdir.
          if (isFsError(lockError, 'ENOENT')) continue;
          throw lockError;
        }
        if (Date.now() - start >= 10_000) {
          throw new InventoryError('LOCK_TIMEOUT', `Timed out waiting for inventory lock ${this.lockDir}. Inspect its owner.json for the writer PID and host. If no writer is running, remove this lock directory and retry.`);
        }
        await delay(15 + Math.floor(Math.random() * 25));
      }
    }
    try {
      const owner = await open(ownerPath, 'wx', 0o600);
      try { await owner.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), createdAt: new Date().toISOString() })); }
      finally { await owner.close(); }
      return await work();
    } finally {
      await unlink(ownerPath).catch(error => { if (!isFsError(error, 'ENOENT')) throw error; });
      await rmdir(this.lockDir);
    }
  }

  private async atomicWrite(record: Technique): Promise<void> {
    await this.checkDirectories();
    const destination = this.recordPath(record.id);
    try {
      const stat = await lstat(destination);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new InventoryError('UNSAFE_PATH', `Refusing to replace a non-regular file: ${destination}`);
    } catch (error) { if (!isFsError(error, 'ENOENT')) throw error; }
    const temporary = join(this.techniquesDir, `.${record.id}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, destination);
      // Persist the directory entry as well as the file on local filesystems.
      const directory = await open(this.techniquesDir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (!isFsError(error, 'ENOENT')) throw error; });
    }
  }

  async create(input: TechniqueCreate): Promise<Technique> {
    const value = parse(techniqueCreateSchema, input, 'Invalid new technique');
    const id = value.id ?? slug(value.title);
    return this.withWriteLock(async () => {
      try {
        await this.readRecord(id);
        throw new InventoryError('CONFLICT', `Technique '${id}' already exists. Choose another ID or update its current revision.`);
      } catch (error) {
        if (!(error instanceof InventoryError && error.code === 'NOT_FOUND')) throw error;
      }
      const now = new Date().toISOString();
      const record = parse(techniqueSchema, { ...value, id, createdAt: now, updatedAt: now, revision: 1 }, 'Invalid new technique');
      await this.atomicWrite(record);
      return record;
    });
  }

  async update(id: string, expectedRevision: number, patch: TechniquePatch): Promise<Technique> {
    this.recordPath(id);
    parse(z.number().int().positive(), expectedRevision, 'Invalid expected revision');
    const value = parse(techniquePatchSchema, patch, 'Invalid technique patch');
    return this.withWriteLock(async () => {
      const current = await this.readRecord(id);
      if (current.revision !== expectedRevision) {
        throw new InventoryError('CONFLICT', `Technique '${id}' is at revision ${current.revision}, not ${expectedRevision}. Read it again before updating.`);
      }
      const record = parse(techniqueSchema, {
        ...current, ...value, updatedAt: new Date().toISOString(), revision: current.revision + 1,
      }, 'Invalid updated technique');
      await this.atomicWrite(record);
      return record;
    });
  }

  /** Preflight every conflict before writing; reruns skip identical domain content. */
  async importRecords(input: Technique[]): Promise<{ created: string[]; skipped: string[] }> {
    const records = parse(z.array(techniqueSchema), input, 'Invalid import');
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.id)) throw new InventoryError('INVALID_DATA', `Import contains duplicate ID '${record.id}'.`);
      ids.add(record.id);
    }
    const domainContent = ({ createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...rest }: Technique) => JSON.stringify(rest);
    return this.withWriteLock(async () => {
      const pending: Technique[] = [];
      const skipped: string[] = [];
      for (const record of records) {
        try {
          const current = await this.readRecord(record.id);
          if (domainContent(current) !== domainContent(record)) {
            throw new InventoryError('CONFLICT', `Imported technique '${record.id}' differs from the existing record. Resolve it explicitly before importing.`);
          }
          skipped.push(record.id);
        } catch (error) {
          if (!(error instanceof InventoryError && error.code === 'NOT_FOUND')) throw error;
          pending.push(record);
        }
      }
      for (const record of pending) await this.atomicWrite(record);
      return { created: pending.map(record => record.id), skipped };
    });
  }

  async search(options: SearchOptions = {}): Promise<{ total: number; items: SearchItem[] }> {
    const filter = parse(searchSchema, options, 'Invalid search');
    const queryTokens = [...new Set(tokens(filter.query))];
    const phrase = normalize(filter.query.trim());
    const items: SearchItem[] = [];
    for (const record of await this.listAll()) {
      if (filter.status ? record.status !== filter.status : record.status === 'archived') continue;
      if (filter.project !== undefined && normalize(record.project) !== normalize(filter.project)) continue;
      if (filter.kind !== undefined && record.kind !== filter.kind) continue;
      if (filter.evidenceLevel !== undefined && record.evidence.level !== filter.evidenceLevel) continue;
      if (!filter.tags.every(tag => record.tags.some(value => normalize(value) === normalize(tag)))) continue;
      const fields: Array<[string, number]> = [
        [record.title, 8], [record.tags.join(' '), 6], [record.summary, 4], [record.whenToUse, 3],
        [record.content, 1], [record.limitations, 1], [record.nextSteps, 1], [record.project, 2],
        [record.evidence.details, 1],
      ];
      let score = 0;
      const matched = new Set<string>();
      for (const [text, weight] of fields) {
        const fieldTokens = new Set(tokens(text));
        for (const token of queryTokens) if (fieldTokens.has(token)) { score += weight; matched.add(token); }
        if (phrase && normalize(text).includes(phrase)) score += weight * 2;
      }
      if (queryTokens.length && matched.size !== queryTokens.length) continue;
      const { id, title, summary, tags, project, kind, status, revision } = record;
      items.push({ id, title, summary, tags, project, kind, status, revision, evidenceLevel: record.evidence.level, score });
    }
    items.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { total: items.length, items: items.slice(filter.offset, filter.offset + filter.limit) };
  }

  async stats(): Promise<{
    total: number; byStatus: Record<string, number>; byKind: Record<string, number>;
    byEvidenceLevel: Record<string, number>; byProject: Record<string, number>; byTag: Record<string, number>;
  }> {
    const records = await this.listAll();
    const result = { total: records.length, byStatus: {} as Record<string, number>, byKind: {} as Record<string, number>, byEvidenceLevel: {} as Record<string, number>, byProject: {} as Record<string, number>, byTag: {} as Record<string, number> };
    const count = (map: Record<string, number>, key: string) => Object.defineProperty(map, key, { value: (Object.hasOwn(map, key) ? map[key]! : 0) + 1, enumerable: true, configurable: true, writable: true });
    for (const record of records) {
      count(result.byStatus, record.status); count(result.byKind, record.kind);
      count(result.byEvidenceLevel, record.evidence.level); count(result.byProject, record.project);
      for (const tag of record.tags) count(result.byTag, tag);
    }
    return result;
  }
}

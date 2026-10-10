import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { techniqueSchema } from "../src/schema.js";
import { InventoryStore } from "../src/store.js";

type Source = {
  project?: string;
  path?: string;
  line?: number;
  url?: string;
  sha256?: string;
  note?: string;
};
type CatalogEntry = {
  id: string;
  title: string;
  tags: string[];
  status: string;
  result: string;
  why_reusable: string;
  limits: string;
  artifacts: string[];
  sources: { file: string; line?: number }[];
  next_step: string;
};
type Extra = {
  title: string;
  value: string;
  artifacts: string[];
  sources: { file: string; line?: number }[];
};
type Replay = {
  script: string;
  status: string;
  saved_result_matches_excluding_timing?: boolean;
  source_sha256?: string;
  verification_summary?: unknown;
  complete_saved_result?: string;
};
type Catalog = {
  title: string;
  source_project: string;
  survey_date_local: string;
  scope: string;
  evidence_policy: string;
  entries: CatalogEntry[];
  additional_results: Extra[];
  source_fingerprints: Record<string, string>;
  supersession_notes: string[];
  suggested_followup_tasks: { title: string; entries: string[]; prompt: string }[];
  recommended_first: string[];
  survey_validation: {
    method: string;
    replays: Replay[];
    additional_agent_checks: string[];
  };
};

const kinds: Record<string, "technique" | "result" | "counterexample" | "workflow"> = {
  "SEARCH-01": "technique", "CERT-01": "workflow", "ALG-01": "technique",
  "TENSOR-01": "result", "TENSOR-02": "counterexample", "STRUCT-01": "technique",
  "ALG-02": "result", "ALG-03": "result", "ALG-04": "technique",
  "ALG-05": "result", "META-01": "counterexample", "PROB-01": "result",
  "COMB-01": "technique", "LOWER-01": "technique", "SEARCH-02": "workflow",
};

const extraMetadata = [
  { tags: ["entropy", "exact moments", "rational arithmetic"], kind: "technique", related: ["CERT-01"], when: "Bounding analytic or probabilistic quantities with exactly computable finite moments.", limits: "The local KL statement is limited to its audited simple-path/cycle domain. Its proposed PPSZ runtime consequence is suspended by the multigraph counterexample." },
  { tags: ["codes", "tensor decompositions", "cancellation"], kind: "technique", related: ["ALG-01", "LOWER-01"], when: "Constructing exact tensor expansions from binary code projectors and combining residual corrections.", limits: "The expected bound is in the resource count. Finite identities do not improve the asymptotic guarantee; an uncombined-recursion lower bound does not cover joint cancellation." },
  { tags: ["finite fields", "character sums", "algebraic curves"], kind: "technique", related: ["ALG-04", "ALG-05"], when: "Rewriting inverse phases restricted to scalar subfield lines as rational character sums.", limits: "Retain excluded input points after pole cancellation and account for infinity. These probes are not fast general point-counting implementations." },
  { tags: ["renormalization", "bounded interfaces", "recursive contraction"], kind: "result", related: ["TENSOR-02", "STRUCT-01"], when: "Benchmarking exact contraction on recursively assembled networks with a fixed boundary.", limits: "The displayed recurrence belongs to the triangular NAE gasket and its stated boundary convention. It does not provide a recurrence for arbitrary networks." },
  { tags: ["sparse representations", "linear span", "counterexamples"], kind: "counterexample", related: ["SEARCH-01", "SEARCH-02"], when: "Checking whether a linear separating functional can possibly certify a sparse-representation obstruction.", limits: "This is a dictionary-specific finite example. Nine is an upper bound on packet count, not an established minimum." },
  { tags: ["phase search", "support geometry", "symmetry"], kind: "technique", related: ["SEARCH-02", "ALG-03"], when: "Searching real quadratic phases under the stated order-three action by separating support from signs.", limits: "The decomposition uses the stated binary averaging action and characteristic-three norm formula. It is not asserted for arbitrary phase families or group actions." },
] as const;

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${label}`);
  return value;
}

function portablePath(value: string): string {
  // Source paths are relative to the original project, not this repository.
  if (/^(?:[\\/]|[a-zA-Z]:)/.test(value) || value.includes("\\") || value.split("/").some(p => p === ".." || p === "")) {
    throw new Error(`Source path must be portable and project-relative: ${value}`);
  }
  return value;
}

function catalogInput(value: unknown): Catalog {
  if (typeof value !== "object" || value === null) throw new Error("Catalog must be an object");
  const c = value as Catalog;
  if (c.source_project !== "ETH") throw new Error("Expected the ETH source catalog");
  if (!Array.isArray(c.entries) || c.entries.length !== 15 || !Array.isArray(c.additional_results) || c.additional_results.length !== 6) {
    throw new Error("Expected all 15 main ETH cards and all 6 additional notes");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.survey_date_local)) throw new Error("Invalid survey_date_local");
  text(c.scope, "scope");
  text(c.evidence_policy, "evidence_policy");
  if (!c.source_fingerprints || !Array.isArray(c.supersession_notes) || !c.survey_validation) throw new Error("Missing provenance metadata");
  const known = new Set(Object.keys(kinds));
  for (const entry of c.entries) {
    if (!known.delete(entry.id)) throw new Error(`Unknown or duplicate origin ID: ${entry.id}`);
  }
  return c;
}

function importedId(id: string): string { return `eth-${id.toLowerCase()}`; }

function sourcesFor(c: Catalog, item: CatalogEntry | Extra, origin: string, catalogHash: string): Source[] {
  const sources: Source[] = [{
    project: "ETH", path: "inventory/catalog.json", sha256: catalogHash,
    note: `Imported origin ID: ${origin}. Source catalog path is relative to the original ETH project.`,
  }];
  for (const source of item.sources) {
    const path = portablePath(text(source.file, "source file"));
    sources.push({ project: "ETH", path, ...(source.line === undefined ? {} : { line: source.line }), ...(c.source_fingerprints[path] ? { sha256: c.source_fingerprints[path] } : {}) });
  }
  for (const artifact of item.artifacts) {
    const colon = artifact.indexOf(":");
    const path = portablePath(colon < 0 ? artifact : artifact.slice(0, colon));
    const symbol = colon < 0 ? undefined : artifact.slice(colon + 1);
    sources.push({ project: "ETH", path, ...(c.source_fingerprints[path] ? { sha256: c.source_fingerprints[path] } : {}), note: symbol ? `Artifact symbol: ${symbol}` : "Implementation or saved-result artifact; source content is not bundled." });
  }
  return sources;
}

function evidenceDetails(c: Catalog, item: CatalogEntry): string {
  const paths = new Set(item.artifacts.map(a => a.split(":")[0]));
  const replayDetails = c.survey_validation.replays.filter(r => paths.has(r.script)).map(r =>
    `Recorded survey replay: ${r.script}; status ${r.status}; matches saved result excluding timing: ${r.saved_result_matches_excluding_timing === true}. Verification summary: ${JSON.stringify(r.verification_summary)}. Complete saved result: ${r.complete_saved_result ?? "not specified"}.`,
  );
  return [item.status, c.evidence_policy, ...replayDetails].join("\n\n");
}

/** Deterministic conversion; does not read source-code artifacts or expose source_root. */
export function buildEthRecords(input: unknown, catalogHash: string) {
  const c = catalogInput(input);
  if (!/^[0-9a-f]{64}$/.test(catalogHash)) throw new Error("Invalid catalog SHA-256");
  const timestamp = `${c.survey_date_local}T00:00:00.000Z`;
  const common = { project: "ETH", status: "active", createdAt: timestamp, updatedAt: timestamp, revision: 1 } as const;
  const main = c.entries.map(entry => {
    const relatedIds = [...new Set(c.suggested_followup_tasks.filter(t => t.entries.includes(entry.id)).flatMap(t => t.entries))]
      .filter(id => id !== entry.id).map(importedId).sort();
    // A written derivation is not silently promoted to an explicit proof claim.
    const level = /\bproofs?\b/i.test(entry.status) ? "proof" : /\bexhaustive\b/i.test(entry.status) ? "exhaustive" : "experimental";
    return techniqueSchema.parse({
      id: importedId(entry.id), title: text(entry.title, "title"), summary: text(entry.why_reusable, "why_reusable"),
      content: text(entry.result, "result"), whenToUse: entry.why_reusable, limitations: text(entry.limits, "limits"),
      tags: [...entry.tags], kind: kinds[entry.id], evidence: { level, details: evidenceDetails(c, entry) },
      sources: sourcesFor(c, entry, entry.id, catalogHash), nextSteps: text(entry.next_step, "next_step"), relatedIds, ...common,
    });
  });
  const extras = c.additional_results.map((entry, i) => {
    const origin = `EXTRA-${String(i + 1).padStart(2, "0")}`;
    const meta = extraMetadata[i]!;
    return techniqueSchema.parse({
      id: importedId(origin), title: text(entry.title, "title"), summary: entry.value.split(/(?<=\.)\s/)[0],
      content: text(entry.value, "value"), whenToUse: meta.when, limitations: meta.limits,
      tags: [...meta.tags], kind: meta.kind,
      evidence: { level: "unassessed", details: `Imported additional note ${origin}. The source catalog did not assign this note a separate evidence assessment; assertions and qualifications are preserved in its content.\n\n${c.evidence_policy}` },
      sources: sourcesFor(c, entry, origin, catalogHash), nextSteps: "Review the cited assumptions and independent checks before extracting a reusable implementation or extending the stated result.",
      relatedIds: meta.related.map(importedId), ...common,
    });
  });
  const records = [...main, ...extras];
  // Fail closed rather than publishing local absolute paths present in a future catalog.
  const serialized = JSON.stringify(records);
  if (/(?:\/Users\/|\/home\/|[a-zA-Z]:\\\\)/.test(serialized)) throw new Error("Personal absolute path found in imported data");
  return records;
}

export function buildEthReadme(input: unknown, catalogHash: string): string {
  const c = catalogInput(input);
  return `# Technique inventory\n\nThis readable, Git-tracked collection imports all 15 main cards and all 6 additional notes from the ETH survey catalog. Each JSON file in \`techniques/\` is a standalone inventory record. No raw research code or binary search corpus is included.\n\n## Provenance and dates\n\nSources use paths relative to the original ETH project. They are provenance references, not promises that those files exist in this repository. Source SHA-256 values are preserved from the catalog; the importer does not reread or recertify source artifacts. Every record retains its origin ID in its catalog source note. Additional notes receive stable positional IDs EXTRA-01 through EXTRA-06.\n\nThe imported catalog SHA-256 is \`${catalogHash}\`. The original local survey date is \`${c.survey_date_local}\`. Record creation/update timestamps normalize that date to midnight UTC solely for deterministic import metadata; they are not the actual time of proof verification. No \`verifiedAt\` is invented.\n\n## Evidence and scope\n\n${c.scope}\n\n${c.evidence_policy}\n\nThe original status text is preserved in each main record's evidence details. \`proof\` is used only when that status explicitly says proof or proofs. Otherwise an explicit exhaustive label yields \`exhaustive\`; remaining main records use \`experimental\` conservatively. All six additional notes use \`unassessed\`. This classification does not imply formal verification or literature novelty. The record lifecycle status \`active\` means the scoped card is retained for reuse, not that every historical proposal mentioned inside it remains valid.\n\n## Supersessions and caveats\n\n${c.supersession_notes.map(s => `- ${s}`).join("\n")}\n\n## Recorded survey verification\n\n${c.survey_validation.method}\n\n${c.survey_validation.replays.map(r => `- \`${r.script}\`: ${r.status}; saved output matches excluding timing: ${r.saved_result_matches_excluding_timing === true}. Source SHA-256: \`${r.source_sha256 ?? "not supplied"}\`. Complete result: \`${r.complete_saved_result ?? "not supplied"}\`.`).join("\n")}\n\nAdditional checks recorded by the source survey:\n\n${c.survey_validation.additional_agent_checks.map(s => `- ${s}`).join("\n")}\n\nThese are reports preserved from the earlier survey. Importing JSON does not rerun any research experiment.\n\n## Suggested starting points\n\n${c.recommended_first.map(id => `- [${id}](techniques/${importedId(id)}.json)`).join("\n")}\n\nThe related-ID links on main cards preserve co-membership in suggested follow-up tasks; they do not assert mathematical dependence. Extra-card links are editorial navigation suggestions.\n\n## Reimporting\n\nRun from the package root with explicit locations:\n\n\`\`\`sh\nnpm run import:eth -- --catalog /path/to/ETH/inventory/catalog.json --data-dir ./inventory\n\`\`\`\n\nThe importer uses the shared inventory writer lock, validates all records with the shared schema, checks every destination before writing, skips records with identical domain fields (ignoring timestamps and revision), and aborts on any existing conflicting ID. Existing records are never overwritten. The batch is not a crash-atomic transaction: an I/O failure or process crash can leave an initial subset newly created. Re-run after resolving the issue; identical records will be skipped. The README is also created only if absent; preserve or review existing documentation explicitly.\n`;
}

function argumentsFor(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if ((key !== "--catalog" && key !== "--data-dir") || !value || value.startsWith("--") || parsed[key]) {
      throw new Error("Usage: import-eth --catalog PATH --data-dir DIR (both required once)");
    }
    parsed[key] = value;
  }
  if (!parsed["--catalog"] || !parsed["--data-dir"]) throw new Error("Both --catalog and --data-dir are required");
  return { catalog: resolve(parsed["--catalog"]), dataDir: resolve(parsed["--data-dir"]) };
}

export async function importEth(argv: string[]) {
  const options = argumentsFor(argv);
  const bytes = await readFile(options.catalog);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const input: unknown = JSON.parse(bytes.toString("utf8"));
  const records = buildEthRecords(input, hash);
  const result = await new InventoryStore(options.dataDir).importRecords(records);
  let readme = "preserved";
  try {
    await writeFile(join(options.dataDir, "README.md"), buildEthReadme(input, hash), { flag: "wx" });
    readme = "created";
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return { imported: result.created.length, skipped: result.skipped.length, total: records.length, readme };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  importEth(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

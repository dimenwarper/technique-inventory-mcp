# Technique inventory

This readable, Git-tracked collection imports all 15 main cards and all 6 additional notes from the ETH survey catalog. Each JSON file in `techniques/` is a standalone inventory record. No raw research code or binary search corpus is included.

## Provenance and dates

Sources use paths relative to the original ETH project. They are provenance references, not promises that those files exist in this repository. Source SHA-256 values are preserved from the catalog; the importer does not reread or recertify source artifacts. Every record retains its origin ID in its catalog source note. Additional notes receive stable positional IDs EXTRA-01 through EXTRA-06.

The imported catalog SHA-256 is `1371d37ce8d49db9f6c2bf849422e2f07eba617423f098183b55bd6224345983`. The original local survey date is `2026-10-09`. Record creation/update timestamps normalize that date to midnight UTC solely for deterministic import metadata; they are not the actual time of proof verification. No `verifiedAt` is invented.

## Evidence and scope

Survey of the project file inventory, round summaries, continuation and attack notes, with targeted inspection of proofs, implementations, and saved results. Raw binary corpora were indexed rather than fully decoded. This is an extraction inventory, not a claim that every experiment was rerun.

Written proof means a proof is present in the project and was reviewed for this survey; it does not imply formal verification or established literature novelty. Proposed uses outside this project are transfer suggestions, not demonstrated applications. Scripts are working research prototypes with cross-file imports, not a standalone library.

The original status text is preserved in each main record's evidence details. `proof` is used only when that status explicitly says proof or proofs. Otherwise an explicit exhaustive label yields `exhaustive`; remaining main records use `experimental` conservatively. All six additional notes use `unassessed`. This classification does not imply formal verification or literature novelty. The record lifecycle status `active` means the scoped card is retained for reuse, not that every historical proposal mentioned inside it remains valid.

## Supersessions and caveats

- The entropy/PPSZ runtime implication is suspended by the parallel-edge counterexample; retain only the audited local-domain result.
- The padded common-coordinate cubic-atom proposal has no exact rank advantage: the late graph-slice theorem in curve_tower_round10.txt proves equality with ordinary stabilizer rank.
- The all-unphased binary-affine and later phased attacks supersede the earlier unphased F4-affine finite census. The surviving bounds remain finite and dictionary-specific.
- No two-norm expression exists for the specified complementary two-block directions with arbitrary stabilizer phases; for all directions both affine seed dimensions at most five are excluded even with arbitrary nonzero amplitudes over any characteristic-three field. Neither result excludes every six-stabilizer decomposition.
- Large genus, high flattening rank, dense coupling, and many crossings are not generic hardness proofs; preserve the positive counterexamples alongside any obstruction.
- No general SAT speedup, ETH refutation, or literature novelty claim is established by this inventory.

## Recorded survey verification

Six full existing scripts run from temporary copies to preserve original research outputs; results match saved JSON after excluding timing fields. Large attack enumerations were not rerun.

- `crossing_batch_round10.py`: PASS; saved output matches excluding timing: true. Source SHA-256: `68eab3096611ed3cc7442b47439f235af7a8965d1642b4c9d63306319a66f8ae`. Complete result: `crossing_batch_round10_results.json`.
- `curve_tower_round10.py`: PASS; saved output matches excluding timing: true. Source SHA-256: `d43c1a6b7bfc678f40b607cae2dcf48e8beb4f5379efdbb243d2329574146951`. Complete result: `curve_tower_round10_results.json`.
- `continuation_permanent_hash.py`: PASS; saved output matches excluding timing: true. Source SHA-256: `a7c7ad820cdbc4b4f5e7d68526aaae37473becdb008d496a71670c555079d5e3`. Complete result: `continuation_permanent_hash_results.json`.
- `finite_field_gauss_round8.py`: PASS; saved output matches excluding timing: true. Source SHA-256: `9a8b9c2f205ca76ca7abf8508f429f6889a8de449f85ef3315a30e28bf5bf002`. Complete result: `finite_field_gauss_round8_results.json`.
- `continuation_phased_orbit_module.py`: PASS; saved output matches excluding timing: true. Source SHA-256: `087bc30b5b082838133fafbb2242c283eedb5b2da4cc1bcc6f94e7945658bdda`. Complete result: `continuation_phased_orbit_module_results.json`.
- `attack_phase_constraints_quotient_audit.py`: PASS; saved output matches excluding timing: true. Source SHA-256: `b7c88e373bcc2361b7cec6c6d66bf8ec4f56a37d0bcf893ed85f2ca954c1e13d`. Complete result: `attack_phase_constraints_quotient_audit_results.json`.

Additional checks recorded by the source survey:

- 729 exhaustive ordered quotient-pair tests over F3^3
- Permanent example: unconditioned residue 0, parity-conditioned residue 2, inconsistent equations residue 0
- Exact affine quadratic-mask probabilities through dimension six

These are reports preserved from the earlier survey. Importing JSON does not rerun any research experiment.

## Suggested starting points

- [SEARCH-01](techniques/eth-search-01.json)
- [CERT-01](techniques/eth-cert-01.json)
- [ALG-01](techniques/eth-alg-01.json)
- [TENSOR-01](techniques/eth-tensor-01.json)
- [TENSOR-02](techniques/eth-tensor-02.json)

The related-ID links on main cards preserve co-membership in suggested follow-up tasks; they do not assert mathematical dependence. Extra-card links are editorial navigation suggestions.

## Reimporting

Run from the package root with explicit locations:

```sh
npm run import:eth -- --catalog /path/to/ETH/inventory/catalog.json --data-dir ./inventory
```

The importer uses the shared inventory writer lock, validates all records with the shared schema, checks every destination before writing, skips records with identical domain fields (ignoring timestamps and revision), and aborts on any existing conflicting ID. Existing records are never overwritten. The batch is not a crash-atomic transaction: an I/O failure or process crash can leave an initial subset newly created. Re-run after resolving the issue; identical records will be skipped. The README is also created only if absent; preserve or review existing documentation explicitly.

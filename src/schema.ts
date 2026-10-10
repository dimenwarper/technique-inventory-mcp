import { z } from 'zod';

export const techniqueIdSchema = z.string().min(1).max(96).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'Use lowercase letters, digits, and single hyphens; start and end with a letter or digit.',
);

export const kindSchema = z.enum(['technique', 'result', 'counterexample', 'workflow']);
export const evidenceLevelSchema = z.enum(['unassessed', 'conjecture', 'experimental', 'exhaustive', 'proof']);
export const statusSchema = z.enum(['active', 'superseded', 'archived']);
const dateTimeSchema = z.iso.datetime({ offset: true });
const tagsSchema = z.array(z.string().trim().min(1).max(80)).max(100)
  .transform(values => [...new Set(values)]);

export const evidenceSchema = z.strictObject({
  level: evidenceLevelSchema.default('unassessed'),
  details: z.string().default(''),
  verifiedAt: dateTimeSchema.optional(),
});

export const sourceSchema = z.strictObject({
  project: z.string().optional(),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  url: z.url({ protocol: /^https?$/ }).optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  note: z.string().min(1).optional(),
}).refine(value => Boolean(value.path || value.url || value.note), {
  message: 'A source must include a path, URL, or note.',
});

const editableShape = {
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4000),
  content: z.string().min(1),
  whenToUse: z.string(),
  limitations: z.string(),
  tags: tagsSchema,
  project: z.string(),
  kind: kindSchema,
  evidence: evidenceSchema,
  sources: z.array(sourceSchema),
  nextSteps: z.string(),
  relatedIds: z.array(techniqueIdSchema).transform(values => [...new Set(values)]),
  status: statusSchema,
};

export const techniqueCreateSchema = z.strictObject({
  ...editableShape,
  id: techniqueIdSchema.optional(),
  whenToUse: editableShape.whenToUse.default(''),
  limitations: editableShape.limitations.default(''),
  tags: editableShape.tags.default([]),
  project: editableShape.project.default(''),
  kind: editableShape.kind.default('technique'),
  evidence: editableShape.evidence.default({ level: 'unassessed', details: '' }),
  sources: editableShape.sources.default([]),
  nextSteps: editableShape.nextSteps.default(''),
  relatedIds: editableShape.relatedIds.default([]),
  status: editableShape.status.default('active'),
});

export const techniquePatchSchema = z.strictObject(editableShape).partial()
  .refine(value => Object.keys(value).length > 0, 'Supply at least one editable field.');

export const techniqueSchema = z.strictObject({
  ...editableShape,
  id: techniqueIdSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  revision: z.number().int().positive(),
});

export type Technique = z.infer<typeof techniqueSchema>;
export type TechniqueCreate = z.input<typeof techniqueCreateSchema>;
export type TechniquePatch = z.input<typeof techniquePatchSchema>;

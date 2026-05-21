import { z } from 'zod';
import { atUriSchema, datetimeSchema, didSchema } from './common.js';

export const POST_LEX_ID = 'app.openxiv.post' as const;

export const byteSliceSchema = z.object({
  byteStart: z.number().int().nonnegative(),
  byteEnd: z.number().int().nonnegative(),
});

export const mentionFeatureSchema = z.object({
  $type: z.literal('app.openxiv.post#mention').optional(),
  did: didSchema,
});

export const linkFeatureSchema = z.object({
  $type: z.literal('app.openxiv.post#link').optional(),
  uri: z.string().url(),
});

export const tagFeatureSchema = z.object({
  $type: z.literal('app.openxiv.post#tag').optional(),
  tag: z.string().max(64),
});

export const facetSchema = z.object({
  index: byteSliceSchema,
  features: z.array(z.union([mentionFeatureSchema, linkFeatureSchema, tagFeatureSchema])),
});

export const strongRefSchema = z.object({
  uri: atUriSchema,
  cid: z.string().min(1),
});

export const replyRefSchema = z.object({
  root: strongRefSchema,
  parent: strongRefSchema,
});

export const embedPaperSchema = z.object({
  $type: z.literal('app.openxiv.post#embedPaper').optional(),
  paperUri: atUriSchema,
});

export const embedExternalSchema = z.object({
  $type: z.literal('app.openxiv.post#embedExternal').optional(),
  uri: z.string().url(),
  title: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
});

export const postRecordSchema = z.object({
  $type: z.literal(POST_LEX_ID).optional(),
  text: z.string().min(1).max(3000),
  facets: z.array(facetSchema).optional(),
  reply: replyRefSchema.optional(),
  embed: z.union([embedPaperSchema, embedExternalSchema]).optional(),
  tags: z.array(z.string().max(64)).max(8).optional(),
  langs: z.array(z.string().max(8)).max(3).optional(),
  createdAt: datetimeSchema,
});

export type PostRecord = z.infer<typeof postRecordSchema>;

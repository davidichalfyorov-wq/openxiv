import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { papers, paperVersions, posts, users } from './schema/index.js';

/**
 * Schema-level checks that fail on accidental drift. We deliberately do NOT
 * restate the enum values here — those would be tautological (the test would
 * pin the source of truth to itself). Concurrency / constraint behaviour is
 * covered in the testcontainers suite (`identifiers.concurrency.test.ts`),
 * which spins a real Postgres.
 */
describe('schema invariants', () => {
  it('papers exposes the columns the API and saga depend on', () => {
    const cols = Object.keys(getTableColumns(papers));
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'openxivId',
        'uri',
        'doi',
        'submitterDid',
        'title',
        'license',
        'primaryCategory',
        'status',
        'createdAt',
        'updatedAt',
        'publishedAt',
      ]),
    );
  });

  it('paperVersions carries the storage keys the saga depends on', () => {
    const cols = Object.keys(getTableColumns(paperVersions));
    expect(cols).toEqual(
      expect.arrayContaining([
        'paperId',
        'versionNumber',
        'pdfKey',
        'sourceKey',
        'htmlKey',
        'fileSha256',
        'sizeBytes',
      ]),
    );
  });

  it('users and posts retain the columns dependent code consumes', () => {
    const userCols = Object.keys(getTableColumns(users));
    expect(userCols).toEqual(
      expect.arrayContaining(['id', 'did', 'role', 'displayName', 'handle', 'createdAt']),
    );
    const postCols = Object.keys(getTableColumns(posts));
    expect(postCols).toEqual(
      expect.arrayContaining(['id', 'uri', 'authorDid', 'text', 'createdAt']),
    );
  });
});

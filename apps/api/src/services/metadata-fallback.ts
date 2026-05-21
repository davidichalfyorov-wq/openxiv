import type { ExtractedMetadata } from '@openxiv/clients';
import { extractToFileNodes } from './archive-extract.js';
import { detectEntryTex, extractTexMetadata, type TexMetadata } from './tex-detect.js';

/**
 * Regex-level metadata fallback for the publish saga when GROBID is down.
 *
 * This intentionally reads only explicit TeX metadata from the submitted
 * source bundle. Binary-only uploads get an empty envelope so the saga can
 * continue without inventing paper metadata.
 */
export async function extractFallbackMetadataFromSource(
  source: Buffer,
  filename: string,
): Promise<ExtractedMetadata> {
  const tex = await readTexMetadata(source, filename);
  return {
    ...(tex.title ? { title: tex.title } : {}),
    ...(tex.abstract ? { abstract: tex.abstract } : {}),
    authors: tex.authors,
    references: [],
    bodyText: tex.bodyText,
  };
}

async function readTexMetadata(source: Buffer, filename: string): Promise<TexMetadata> {
  try {
    const files = await extractToFileNodes(source, filename);
    const detected = detectEntryTex(files);
    if (detected.ok) return extractTexMetadata(detected.entry.content);

    if (/\.tex$/i.test(filename)) {
      return extractTexMetadata(source.toString('utf8'));
    }
  } catch {
    // Fallback must never turn a transient metadata outage into a failed publish.
  }
  return { authors: [], keywords: [], bodyText: '' };
}

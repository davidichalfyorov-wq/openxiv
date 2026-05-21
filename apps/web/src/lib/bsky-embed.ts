export interface OpenXivExternalEmbed {
  uri: string;
  title: string;
  description: string;
  path: string;
}

export function extractOpenXivExternalEmbed(embed: unknown): OpenXivExternalEmbed | null {
  if (!isRecord(embed)) return null;
  const type = typeof embed.$type === 'string' ? embed.$type : '';
  if (!type.startsWith('app.bsky.embed.external')) return null;
  if (!isRecord(embed.external)) return null;

  const uri = typeof embed.external.uri === 'string' ? embed.external.uri : '';
  if (!uri) return null;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.hostname !== 'openxiv.net' && url.hostname !== 'www.openxiv.net') return null;
  if (!url.pathname.startsWith('/p/') && !url.pathname.startsWith('/abs/')) return null;

  const title = cleanText(embed.external.title, 'OpenXiv preprint');
  const description = cleanText(embed.external.description, '');
  return {
    uri,
    title,
    description,
    path: `${url.pathname}${url.search}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

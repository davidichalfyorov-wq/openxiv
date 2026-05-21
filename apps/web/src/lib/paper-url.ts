import type { PaperSummary } from './api';
import { publicWebBase } from './public-base';

export function paperPublicPath(paper: Pick<PaperSummary, 'id' | 'openxivUrlId'>): string {
  return paper.openxivUrlId ? `/abs/${paper.openxivUrlId}` : `/paper/${paper.id}`;
}

export function paperPublicUrl(
  paper: Pick<PaperSummary, 'id' | 'openxivUrlId'>,
  buildTimeBase?: string,
): string {
  return `${publicWebBase(buildTimeBase)}${paperPublicPath(paper)}`;
}

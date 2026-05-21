import type { PaperStatus } from './api';

const PAPER_STATUS_LABELS: Record<PaperStatus, string> = {
  draft: 'Draft',
  compiling: 'Preparing PDF',
  compile_failed: 'Needs source fixes',
  pending_disclosure: 'Disclosure needed',
  pending_review: 'Under review',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

export function formatPaperStatus(status: PaperStatus | string): string {
  if (status in PAPER_STATUS_LABELS) {
    return PAPER_STATUS_LABELS[status as PaperStatus];
  }
  return status
    .split('_')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

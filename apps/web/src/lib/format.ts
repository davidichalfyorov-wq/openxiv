/**
 * Render an ISO timestamp as a short relative-time label. Past dates yield
 * "Ns / Nm / Nh / Nd ago"; future timestamps (clock skew, scheduled future
 * publish) yield "in Ns / Nm / Nh / Nd"; anything older than ~30 days falls
 * back to a localised date. Returns "—" on unparseable input rather than
 * the raw "NaN ago" or "Invalid Date".
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  if (typeof iso !== 'string' || iso.length === 0) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffMs = now - t;
  const abs = Math.abs(diffMs);
  const sec = Math.floor(abs / 1000);
  const dir = diffMs >= 0 ? 'past' : 'future';
  const tag = (n: number, unit: string): string => (dir === 'past' ? `${n}${unit} ago` : `in ${n}${unit}`);
  if (sec < 60) return tag(sec, 's');
  const min = Math.floor(sec / 60);
  if (min < 60) return tag(min, 'm');
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return tag(hrs, 'h');
  const days = Math.floor(hrs / 24);
  if (days < 30) return tag(days, 'd');
  return new Date(iso).toLocaleDateString();
}

/**
 * Truncate to `max` user-perceived characters, appending "…". Uses Array.from
 * to split on code points rather than UTF-16 code units, so paired surrogates
 * (emoji, CJK supplementary) are not torn in half. Note: complex grapheme
 * clusters (ZWJ-joined emoji, combining marks) are best-effort — for
 * pedantic perfection we'd need `Intl.Segmenter`, which is overkill here.
 */
export function truncate(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (!Number.isFinite(max) || max <= 0) return '';
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  return `${cps.slice(0, Math.max(0, max - 1)).join('')}…`;
}

export function discloseToneClass(level: 'none' | 'assistant' | 'coauthor' | 'primary'): string {
  switch (level) {
    case 'none':
      return 'badge-tone-neutral';
    case 'assistant':
      return 'badge-tone-info';
    case 'coauthor':
      return 'badge-tone-warning';
    case 'primary':
      return 'badge-tone-caution';
  }
}

export function discloseLabel(level: 'none' | 'assistant' | 'coauthor' | 'primary'): string {
  switch (level) {
    case 'none':
      return 'No AI';
    case 'assistant':
      return 'AI-assisted';
    case 'coauthor':
      return 'AI co-author';
    case 'primary':
      return 'AI-primary';
  }
}

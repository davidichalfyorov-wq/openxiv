import DOMPurify from 'isomorphic-dompurify';

const TEXT_SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
};

export function sanitizePlainText(input: string): string {
  return DOMPurify.sanitize(input.normalize('NFKC'), TEXT_SANITIZE_OPTIONS)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeOptionalPlainText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const clean = sanitizePlainText(input);
  return clean.length > 0 ? clean : null;
}

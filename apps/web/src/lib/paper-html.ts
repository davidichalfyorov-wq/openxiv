import { postProcessHtml, type PostProcessHtmlOptions } from './html-postprocess';

export type { PostProcessHtmlOptions };

export function postProcessPaperHtml(html: string, options?: PostProcessHtmlOptions): string {
  return postProcessHtml(html, options);
}

export interface BriefItem {
  kind: 'featured' | 'claim' | 'open_question' | 'explainer' | 'serendipity';
  present: boolean;
  title: string | null;
  href: string | null;
  blurb: string | null;
}

export interface BriefResponse {
  date: string;
  items: BriefItem[];
  generatedAt: string;
}

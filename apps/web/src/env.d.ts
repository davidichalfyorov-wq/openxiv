import '../.astro/types.d.ts';
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_BASE: string;
  readonly INTERNAL_API_BASE?: string;
  readonly PUBLIC_TWITTER_PAPERSUBMIT_EVENT_ID?: string;
  readonly PUBLIC_TWITTER_SIGNUP_EVENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { useEffect, useRef, useState } from 'react';
import { sha256Hex } from '../lib/hash';

/**
 * Twitter conversion event id for "Signup". Sourced from
 * PUBLIC_TWITTER_SIGNUP_EVENT_ID at build time. Hardcoded fallback
 * matches the launch dashboard so a missing env var doesn't silently
 * skip tracking — we still need to flip the flag in prod to opt in.
 */
const SIGNUP_EVENT_ID =
  (import.meta.env.PUBLIC_TWITTER_SIGNUP_EVENT_ID as string | undefined) ?? 'tw-rch4y-rch5b';

interface OpenxivTwitter {
  event(id: string, params: Record<string, unknown>): void;
}

interface SubmitEventLike {
  preventDefault(): void;
}

declare global {
  interface Window {
    openxivTwitter?: OpenxivTwitter;
    openxivTrack?: (
      eventType: string,
      targetUri: string,
      targetType: string,
      context?: Record<string, unknown>,
    ) => void;
  }
}

interface AvailabilityOk {
  available: true;
  handle: string;
}
interface AvailabilityNo {
  available: false;
  reason:
    | 'too_short'
    | 'too_long'
    | 'invalid_chars'
    | 'all_numeric'
    | 'did_shape'
    | 'reserved'
    | 'impersonation'
    | 'taken';
}
type Availability = AvailabilityOk | AvailabilityNo;

const REASON_COPY: Record<AvailabilityNo['reason'], string> = {
  too_short: 'Handle is too short — at least 3 characters.',
  too_long: 'Handle is too long — at most 30 characters.',
  invalid_chars:
    'Use lowercase letters, digits, dot, underscore, or hyphen. Must start and end with a letter or digit.',
  all_numeric: "Handle can't be all digits — combine letters with digits.",
  did_shape: 'Handle cannot start with did:* — those are reserved for DIDs.',
  reserved: "That name is reserved — pick another.",
  impersonation:
    "That name is too similar to a high-trust name. Pick something distinct so you're not mistaken for the OpenXiv team or a moderator.",
  taken: 'That handle is already taken — pick another.',
};

const DEBOUNCE_MS = 400;

function hasMarketingConsent(): boolean {
  try {
    const m = /(?:^|;\s*)openxiv_consent=([^;]+)/.exec(document.cookie);
    if (!m) return false;
    const v = m[1] ?? '';
    const pad = '==='.slice(0, (4 - (v.length % 4)) % 4);
    const raw = atob(v.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const obj = JSON.parse(new TextDecoder().decode(bytes)) as { v?: number; m?: number };
    return obj.v === 1 && obj.m === 1;
  } catch {
    return false;
  }
}

export default function HandlePicker({ initial }: { initial?: string }): React.ReactElement {
  const [value, setValue] = useState(initial ?? '');
  const [status, setStatus] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setStatus(null);
      setChecking(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      const candidate = value.trim().toLowerCase();
      try {
        const r = await fetch(
          `/api-proxy/me/handle/check?candidate=${encodeURIComponent(candidate)}`,
          { credentials: 'same-origin', headers: { accept: 'application/json' } },
        );
        if (!r.ok) {
          setStatus(null);
          return;
        }
        const data: Availability = await r.json();
        lastCheckedRef.current = candidate;
        setStatus(data);
      } catch {
        setStatus(null);
      } finally {
        setChecking(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const onSubmit = async (e: SubmitEventLike): Promise<void> => {
    e.preventDefault();
    if (!status || !status.available || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api-proxy/me/handle', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ handle: status.handle }),
      });
      if (r.ok) {
        // Twitter Pixel Signup fire — BEFORE the hard navigation so
        // the conversion event lives long enough to reach uwt.js.
        // The helper is consent-gated, DNT-gated, and debounced; here
        // we just pass through. `crypto.randomUUID()` lets Twitter
        // dedupe a Lead conversion if the user retries the form.
        await fireSignupEvent().catch(() => {});
        // Redirect to the new pretty URL. Hard navigation so the SSR
        // header re-renders without the "Pick handle" badge.
        window.location.href = `/@${status.handle}`;
        return;
      }
      const body = await r.json().catch(() => ({}));
      if (body && typeof body === 'object' && 'reason' in body) {
        setStatus({ available: false, reason: body.reason as AvailabilityNo['reason'] });
      } else {
        setError("Couldn't claim the handle. Try a different one.");
      }
    } catch {
      setError("Network problem. Try again in a few seconds.");
    } finally {
      setSubmitting(false);
    }
  };

  const helpText = (() => {
    if (!value.trim()) return 'Type a handle — we check availability live.';
    if (checking) return 'Checking…';
    if (!status) return ' ';
    if (status.available) return `✓ "${status.handle}" is available`;
    return REASON_COPY[status.reason];
  })();

  const helpClass = status?.available ? 'success' : status ? 'error' : 'muted';

  async function fireSignupEvent(): Promise<void> {
    if (typeof window === 'undefined') return;
    const params: Record<string, unknown> = {
      // `conversion_id` is Twitter's idempotency hint — same value
      // on a retry collapses to one Lead at the dashboard side.
      conversion_id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    try {
      const meRes = await fetch('/api-proxy/auth/me', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { user?: { email?: string | null } };
        // Hashed email passes through only when marketing consent is
        // granted; the helper rechecks before firing anyway, but we
        // also avoid computing the hash when we don't need it.
        if (me?.user?.email && hasMarketingConsent()) {
          params['email_address'] = await sha256Hex(me.user.email);
        }
      }
    } catch {
      // Email enrichment failure → still fire the bare conversion.
    }
    window.openxivTrack?.('signup_complete', '/auth/welcome', 'auth', {
      hasEmailHash: typeof params['email_address'] === 'string',
    });
    window.openxivTwitter?.event(SIGNUP_EVENT_ID, params);
    // The next line after this helper is a hard navigation to /@handle.
    // Give uwt.js a short window to flush the queued custom event.
    await new Promise((resolve) => window.setTimeout(resolve, 650));
  }

  return (
    <form onSubmit={onSubmit} className="handle-picker">
      <label htmlFor="handle-input" className="handle-picker-label">
        Handle
      </label>
      <div className="handle-picker-input-row">
        <span className="handle-picker-prefix">@</span>
        <input
          id="handle-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={30}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby="handle-help"
          aria-invalid={status?.available === false}
          className="handle-picker-input"
        />
      </div>
      <div id="handle-help" className={`handle-picker-help ${helpClass}`}>
        {helpText}
      </div>
      {error && <div className="handle-picker-error">{error}</div>}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={!status?.available || submitting}
      >
        {submitting ? 'Claiming…' : 'Claim handle'}
      </button>
      <style>{`
        .handle-picker { display: flex; flex-direction: column; gap: 8px; }
        .handle-picker-label { font-size: 14px; color: var(--text-secondary); }
        .handle-picker-input-row {
          display: flex; align-items: center; gap: 6px;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 10px;
          background: var(--surface);
        }
        .handle-picker-prefix { color: var(--text-tertiary); }
        .handle-picker-input {
          flex: 1;
          border: none; outline: none; background: transparent;
          font: inherit; color: inherit;
        }
        .handle-picker-help { font-size: 13px; min-height: 18px; }
        .handle-picker-help.muted { color: var(--text-tertiary); }
        .handle-picker-help.success { color: var(--success, #2c7a3f); }
        .handle-picker-help.error { color: var(--danger, #b3261e); }
        .handle-picker-error { font-size: 13px; color: var(--danger, #b3261e); }
      `}</style>
    </form>
  );
}

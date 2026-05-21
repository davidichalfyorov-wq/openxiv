import { useState, type JSX } from 'react';
import { browserClient, type PaperStatus } from '../lib/api';
import { formatPaperStatus } from '../lib/paper-status';

interface Props {
  paperId: string;
  initialStatus: PaperStatus;
  lastError?: string | null;
}

/**
 * Submit-saga retry trigger. The saga auto-runs on submission; this button
 * exists so authors and moderators can re-kick a stuck pipeline (any stage
 * that failed gets retried from the first incomplete stage).
 */
export function PublishButton({ paperId, initialStatus, lastError }: Props): JSX.Element {
  const [status, setStatus] = useState<PaperStatus>(initialStatus);
  const [error, setError] = useState<string | null>(lastError ?? null);
  const [working, setWorking] = useState(false);

  if (status === 'published' && !error) {
    return <span className="badge badge-tone-info">Published</span>;
  }

  async function retry(): Promise<void> {
    setWorking(true);
    setError(null);
    try {
      await browserClient().retrySaga(paperId);
      setStatus('compiling');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="stack-sm">
      <button type="button" className="btn btn-primary" onClick={retry} disabled={working}>
        {working ? 'Retrying…' : 'Retry processing'}
      </button>
      <span className="muted">Status: {formatPaperStatus(status)}</span>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

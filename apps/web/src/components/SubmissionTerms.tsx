import { useEffect, useRef, type JSX } from 'react';
import {
  SUBMISSION_TERMS_LABEL,
  SUBMISSION_TERMS_SECTIONS,
  SUBMISSION_TERMS_VERSION,
} from '@openxiv/shared/submission-terms';

interface Props {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  acceptedAlready: boolean;
}

/**
 * Modal that renders the canonical submission terms. The "Accept" button is
 * the only thing that flips the wizard's `termsAccepted` state — closing
 * with the X / ESC does NOT count as acceptance.
 *
 * Implementation note: we use the native <dialog> element so focus-trap,
 * ESC-to-close, and the inert backdrop come for free. Falls back to a plain
 * positioned div in the rare browser that lacks <dialog> support.
 */
export function SubmissionTerms({ open, onClose, onAccept, acceptedAlready }: Props): JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      // showModal traps focus and renders a backdrop.
      try {
        dlg.showModal();
      } catch {
        // Polyfill path: jsdom or older Safari — just toggle the open attribute.
        dlg.setAttribute('open', '');
      }
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // ESC / backdrop click → onClose, but only if user is NOT mid-acceptance
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const handler = (e: Event): void => {
      e.preventDefault();
      onClose();
    };
    dlg.addEventListener('cancel', handler);
    return () => dlg.removeEventListener('cancel', handler);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="terms-dialog"
      aria-labelledby="terms-heading"
      onClick={(e) => {
        // Click on the backdrop (the dialog itself, not its inner content)
        // closes. We detect this by checking that the click target is the
        // dialog element rather than a descendant.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="terms-inner" onClick={(e) => e.stopPropagation()}>
        <header className="terms-head">
          <div>
            <h2 id="terms-heading" style={{ margin: 0, fontFamily: 'var(--font-serif)' }}>
              OpenXiv submission terms
            </h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Version <code>{SUBMISSION_TERMS_VERSION}</code>. Read once, accept once.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close terms dialog"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="terms-body">
          {SUBMISSION_TERMS_SECTIONS.map((section) => (
            <section key={section.heading} className="terms-section">
              <h3 className="terms-section-heading">{section.heading}</h3>
              {section.body.map((para, i) => (
                <p key={i} className="terms-paragraph">{para}</p>
              ))}
            </section>
          ))}
          <p className="muted" style={{ marginTop: 12 }}>
            See also: <a href="/dmca">DMCA / takedown policy</a> · <a href="/privacy">Privacy</a>.
          </p>
        </div>

        <footer className="terms-foot">
          <span className="muted" style={{ fontSize: 13 }}>
            {acceptedAlready ? 'You have already accepted these terms.' : SUBMISSION_TERMS_LABEL}
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              {acceptedAlready ? 'Close' : 'Not now'}
            </button>
            {!acceptedAlready && (
              <button type="button" className="btn btn-primary" onClick={onAccept}>
                I accept the terms
              </button>
            )}
          </div>
        </footer>
      </div>
      <style>{`
        .terms-dialog {
          padding: 0;
          border: none;
          border-radius: var(--radius-lg);
          background: transparent;
          color: var(--text-primary);
          max-width: min(720px, 96vw);
          width: 720px;
        }
        .terms-dialog::backdrop {
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(2px);
        }
        .terms-inner {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
          display: flex;
          flex-direction: column;
          max-height: min(82vh, 720px);
        }
        .terms-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 18px 22px 14px;
          border-bottom: 1px solid var(--border);
        }
        .terms-body {
          padding: 18px 22px;
          overflow-y: auto;
        }
        .terms-section { margin-bottom: 18px; }
        .terms-section:last-child { margin-bottom: 0; }
        .terms-section-heading {
          font-family: var(--font-serif);
          font-size: 17px;
          margin: 0 0 6px;
          color: var(--text-primary);
        }
        .terms-paragraph {
          font-family: var(--font-serif);
          font-size: 15px;
          line-height: 1.65;
          margin: 0 0 8px;
          color: var(--text-primary);
        }
        .terms-foot {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 14px 22px 18px;
          border-top: 1px solid var(--border);
          flex-wrap: wrap;
        }
        @media (max-width: 520px) {
          .terms-head, .terms-body, .terms-foot { padding-left: 14px; padding-right: 14px; }
          .terms-section-heading { font-size: 16px; }
          .terms-paragraph { font-size: 14px; }
        }
      `}</style>
    </dialog>
  );
}

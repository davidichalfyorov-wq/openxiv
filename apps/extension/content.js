// OpenXiv overlay — runs on arXiv.org/abs/* pages.
//
// Strategy:
//   1. Extract the DOI (if arXiv exposes one) and the arXiv id from the URL.
//   2. Ask the configured OpenXiv API whether we have a matching paper.
//   3. If yes, inject a sidebar with Trust Passport lane badges + disclosure level.
//
// The matching endpoint is deliberately lookup-by-arxiv-id / lookup-by-DOI —
// in this MVP we approximate with /api/lookup?arxiv_id=... which the API
// exposes once a paper has been cross-published. Until then the badge says
// "Not on OpenXiv" with a "Submit to OpenXiv" CTA.

(async () => {
  const API_BASE = await getApiBase();
  const arxivId = extractArxivId(location.href);
  if (!arxivId) return;

  const sidebar = createSidebar();
  document.body.appendChild(sidebar);
  setBadge(sidebar, 'Checking OpenXiv…', 'neutral');

  let paper = null;
  try {
    const res = await fetch(`${API_BASE}/api/lookup?arxiv_id=${encodeURIComponent(arxivId)}`, {
      mode: 'cors',
    });
    if (res.ok) {
      paper = await res.json();
    }
  } catch (err) {
    setBadge(sidebar, `OpenXiv unreachable (${err.message})`, 'caution');
    return;
  }

  if (!paper || !paper.id) {
    setBadge(
      sidebar,
      `Not yet on OpenXiv — <a href="${API_BASE.replace(':4000', ':4321')}/submit" target="_blank">submit?</a>`,
      'neutral',
    );
    return;
  }

  // Trust Passport replaces the single 0-100 score with independent lanes.
  // The overlay tone is derived from lane states, not an aggregate score.
  const passport = paper.trust;
  const level = paper.disclosure?.level ?? '(no disclosure)';
  const url = paper.openxivUrlId
    ? `${API_BASE.replace(':4000', ':4321')}/abs/${paper.openxivUrlId}`
    : `${API_BASE.replace(':4000', ':4321')}/paper/${paper.id}`;

  const laneRow = (label, lane) => {
    if (!lane) return '';
    return `<div style="display:flex; justify-content:space-between; font-size:11px; margin-top:4px;">
      <span>${label}</span>
      <span style="text-transform:uppercase; letter-spacing:0.02em; color:${pillColor(lane.state)}; font-weight:600;">${lane.state}</span>
    </div>`;
  };

  setBadge(
    sidebar,
    `
      <div style="font-size: 14px; font-weight: 600;">OpenXiv Trust Passport</div>
      ${laneRow('Transparency', passport?.transparency)}
      ${laneRow('Identity', passport?.identity)}
      ${laneRow('Provenance', passport?.provenance)}
      ${laneRow('Integrity', passport?.integrity)}
      ${laneRow('Social Review', passport?.socialReview)}
      <div style="margin-top: 8px; font-size: 12px;">Disclosure: <strong>${escapeHtml(level)}</strong></div>
      <a href="${url}" target="_blank" style="display:inline-block; margin-top: 8px; font-size: 12px; color: #5a8fde;">
        Open in OpenXiv →
      </a>
    `,
    passportTone(passport),
  );
})();

function pillColor(state) {
  switch (state) {
    case 'strong': return '#2d6b4a';
    case 'partial': return '#2d4a6b';
    case 'absent': return '#8a2b2b';
    default: return '#888';
  }
}

function extractArxivId(href) {
  const m = href.match(/arxiv\.org\/abs\/([0-9.v]+|[a-z-]+\/\d+)/i);
  return m ? m[1] : null;
}

function createSidebar() {
  const root = document.createElement('div');
  root.id = 'openxiv-overlay';
  root.style.position = 'fixed';
  root.style.top = '80px';
  root.style.right = '16px';
  root.style.zIndex = '999999';
  root.style.width = '240px';
  root.style.padding = '14px';
  root.style.border = '1px solid #d8d8e0';
  root.style.borderRadius = '12px';
  root.style.background = '#fff';
  root.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
  root.style.fontFamily = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
  return root;
}

function setBadge(root, html, tone) {
  const colorMap = {
    neutral: '#6b6f76',
    info: '#2d4a6b',
    warning: '#8a6e1f',
    caution: '#8a2b2b',
    good: '#2d6b4a',
  };
  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <strong style="color: ${colorMap[tone] ?? colorMap.neutral}; font-size: 13px;">OpenXiv</strong>
      <span style="color: #999; cursor: pointer;" onclick="this.parentElement.parentElement.remove()" title="dismiss">✕</span>
    </div>
    ${html}
  `;
}

function passportTone(passport) {
  const states = [
    passport?.transparency?.state,
    passport?.identity?.state,
    passport?.provenance?.state,
    passport?.integrity?.state,
    passport?.socialReview?.state,
  ].filter(Boolean);
  if (states.length === 0) return 'neutral';
  if (states.includes('absent')) return 'caution';
  if (states.includes('partial')) return 'info';
  if (states.every((state) => state === 'strong')) return 'good';
  return 'neutral';
}

function escapeHtml(s) {
  const e = document.createElement('div');
  e.textContent = String(s);
  return e.innerHTML;
}

async function getApiBase() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['apiBase'], (result) => {
        resolve(result.apiBase || 'http://localhost:4000');
      });
    } catch {
      resolve('http://localhost:4000');
    }
  });
}

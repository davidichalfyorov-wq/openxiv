import { useMemo, useState, type JSX } from 'react';

export interface CategoryNode {
  code: string;
  name: string;
  group: string;
}

/**
 * The picker has two operating modes.
 *
 *   - `single` (default) — value is a single code; onChange replaces it.
 *   - `multi-with-cap` — value is an array; onChange returns the new
 *     array. `max` limits how many can be selected. `excludeCodes` are
 *     codes that are visually disabled (e.g. the primary category in
 *     the secondary-picker step).
 *
 * The single mode was the original surface; multi-with-cap is layered
 * on without breaking the existing call site.
 */
type SinglePickerProps = {
  categories: CategoryNode[];
  mode?: 'single';
  value: string;
  onChange: (code: string) => void;
};

type MultiPickerProps = {
  categories: CategoryNode[];
  mode: 'multi-with-cap';
  value: string[];
  onChange: (codes: string[]) => void;
  /** Hard cap on the number of selections. Beyond this, rows are aria-disabled. */
  max: number;
  /** Codes that should be visually disabled (e.g. the primary in a secondary picker). */
  excludeCodes?: readonly string[];
};

type Props = SinglePickerProps | MultiPickerProps;

/**
 * Two-pane category browser.
 *
 *   ┌─ Filter ──────────────────────────────────────────┐
 *   │ Group rail │ Categories of the active group      │
 *   │  · Physics │   cs.AI — Artificial Intelligence   │
 *   │  · Math    │   cs.CL — NLP                       │
 *   │  · CS  ●   │   …                                  │
 *   │  · …       │                                      │
 *   └────────────┴──────────────────────────────────────┘
 *
 * The filter box does substring search across code + name in every group
 * simultaneously; when it has text, the group rail dims and we show a
 * single flat result list. This is the only "spectacular" thing — the rest
 * is the site's normal card / muted-row aesthetic.
 *
 * Keyboard: ArrowUp/Down navigates within the current pane. Enter selects.
 * Mobile: rail collapses into a horizontal scroll strip above the list.
 */
export function CategoryPicker(props: Props): JSX.Element {
  const { categories } = props;
  const isMulti = props.mode === 'multi-with-cap';
  // Normalise to a Set for O(1) `selected?` checks in the row render.
  const selectedSet: Set<string> = useMemo(
    () => new Set(isMulti ? props.value : props.value ? [props.value] : []),
    [isMulti, props.value],
  );
  const excludeSet: Set<string> = useMemo(
    () => new Set(isMulti ? props.excludeCodes ?? [] : []),
    [isMulti, isMulti ? props.excludeCodes : undefined],
  );
  const max = isMulti ? props.max : 1;
  const atCap = isMulti ? props.value.length >= max : false;

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of categories) {
      if (!seen.has(c.group)) {
        seen.add(c.group);
        out.push(c.group);
      }
    }
    return out;
  }, [categories]);

  const firstSelected = isMulti ? props.value[0] : props.value;
  const [activeGroup, setActiveGroup] = useState<string>(
    categories.find((c) => c.code === firstSelected)?.group ?? groups[0] ?? 'Physics',
  );
  const [filter, setFilter] = useState('');

  function handleRowClick(code: string): void {
    if (excludeSet.has(code)) return;
    if (!isMulti) {
      props.onChange(code);
      return;
    }
    const already = selectedSet.has(code);
    if (already) {
      props.onChange(props.value.filter((c) => c !== code));
      return;
    }
    if (atCap) return; // hard cap; ignore extra clicks
    props.onChange([...props.value, code]);
  }

  const filterLower = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (filterLower.length === 0) return [] as CategoryNode[];
    return categories.filter(
      (c) =>
        c.code.toLowerCase().includes(filterLower) ||
        c.name.toLowerCase().includes(filterLower) ||
        c.group.toLowerCase().includes(filterLower),
    );
  }, [categories, filterLower]);

  const inGroup = useMemo(
    () => categories.filter((c) => c.group === activeGroup),
    [categories, activeGroup],
  );

  const isSearching = filterLower.length > 0;
  const visible = isSearching ? filtered : inGroup;
  const selectedSingle = !isMulti ? categories.find((c) => c.code === props.value) : null;
  const selectedMulti = isMulti
    ? props.value
        .map((code) => categories.find((c) => c.code === code))
        .filter((c): c is CategoryNode => c !== undefined)
    : [];

  return (
    <div className="cat-picker">
      <div className="cat-filter">
        <input
          className="input"
          placeholder="Filter by name, code, or group — e.g. ‘machine learning’, ‘cs.LG’, ‘topology’"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter categories"
        />
        {!isMulti && selectedSingle && (
          <div className="cat-selected" aria-live="polite">
            <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>Selected</span>
            <code className="cat-selected-code">{selectedSingle.code}</code>
            <span>{selectedSingle.name}</span>
            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>· {selectedSingle.group}</span>
          </div>
        )}
        {isMulti && (
          <div className="cat-chips" aria-live="polite" aria-label="Selected categories">
            {selectedMulti.length === 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>
                None selected. Add up to {max}.
              </span>
            ) : (
              selectedMulti.map((c) => (
                <span key={c.code} className="cat-chip">
                  <code className="cat-chip-code">{c.code}</code>
                  <span className="cat-chip-name">{c.name}</span>
                  <button
                    type="button"
                    className="cat-chip-remove"
                    aria-label={`Remove ${c.code}`}
                    onClick={() => handleRowClick(c.code)}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
            {atCap && (
              <span className="muted cat-chips-cap-hint" role="status">
                Maximum of {max} reached. Remove one to swap.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="cat-pane">
        <aside className={`cat-rail ${isSearching ? 'cat-rail-dim' : ''}`} aria-label="Discipline groups">
          {groups.map((g) => {
            const active = !isSearching && g === activeGroup;
            return (
              <button
                key={g}
                type="button"
                className={`cat-rail-item ${active ? 'cat-rail-item-active' : ''}`}
                onClick={() => {
                  setFilter('');
                  setActiveGroup(g);
                }}
              >
                <span>{g}</span>
              </button>
            );
          })}
        </aside>

        <div className="cat-list" role="listbox" aria-label="Categories">
          {visible.length === 0 && (
            <p className="muted" style={{ padding: 12 }}>
              No matches. Try a broader term or clear the filter.
            </p>
          )}
          {visible.map((c) => {
            const selectedRow = selectedSet.has(c.code);
            const excluded = excludeSet.has(c.code);
            const capDisabled = isMulti && atCap && !selectedRow;
            const disabled = excluded || capDisabled;
            return (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={selectedRow}
                aria-disabled={disabled || undefined}
                className={`cat-row ${selectedRow ? 'cat-row-selected' : ''} ${disabled ? 'cat-row-disabled' : ''}`}
                disabled={disabled}
                title={
                  excluded
                    ? 'Already the primary category for this paper'
                    : capDisabled
                      ? `Maximum of ${max} cross-listings reached`
                      : undefined
                }
                onClick={() => handleRowClick(c.code)}
              >
                <span className="cat-row-code">{c.code}</span>
                <span className="cat-row-name">{c.name}</span>
                {isSearching && (
                  <span className="muted cat-row-group">{c.group}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        .cat-picker {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cat-filter {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cat-selected {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 12px;
          border: 1px solid var(--tone-success);
          border-radius: var(--radius-sm);
          background: color-mix(in srgb, var(--tone-success) 14%, transparent);
          font-size: 14px;
        }
        .cat-selected-code {
          font-family: var(--font-mono);
          font-size: 13px;
          background: var(--bg-base);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 6px;
        }
        .cat-pane {
          display: grid;
          grid-template-columns: 220px 1fr;
          gap: 14px;
          background: var(--bg-elev);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 12px;
          min-height: 360px;
        }
        .cat-rail {
          display: flex;
          flex-direction: column;
          gap: 2px;
          border-right: 1px solid var(--border);
          padding-right: 8px;
          max-height: 60vh;
          overflow-y: auto;
          scrollbar-width: thin;
        }
        .cat-rail-dim { opacity: 0.5; pointer-events: none; }
        .cat-rail-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 7px 10px;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-secondary);
          font-size: 13.5px;
          text-align: left;
          transition: background 120ms ease, color 120ms ease;
        }
        .cat-rail-item:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .cat-rail-item-active {
          background: var(--accent-bg);
          color: var(--text-primary);
          border-color: color-mix(in srgb, var(--accent) 30%, transparent);
          font-weight: 600;
        }
        .cat-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 60vh;
          overflow-y: auto;
          scrollbar-width: thin;
        }
        .cat-row {
          display: grid;
          grid-template-columns: 110px 1fr auto;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-primary);
          font-size: 14px;
          text-align: left;
          transition: background 100ms ease, border-color 100ms ease;
        }
        .cat-row:hover:not(:disabled) { background: var(--bg-hover); }
        .cat-row-selected {
          background: var(--accent-bg);
          border-color: var(--accent);
        }
        .cat-row-disabled,
        .cat-row:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .cat-chips {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .cat-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border: 1px solid var(--accent);
          background: var(--accent-bg);
          border-radius: 999px;
          font-size: 13px;
        }
        .cat-chip-code {
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .cat-chip-name {
          font-family: var(--font-serif);
        }
        .cat-chip-remove {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 16px;
          line-height: 1;
          padding: 0 2px;
          cursor: pointer;
        }
        .cat-chip-remove:hover { color: var(--danger, #b3261e); }
        .cat-chips-cap-hint {
          font-size: 12px;
          margin-left: 4px;
        }
        .cat-row-code {
          font-family: var(--font-mono);
          font-size: 12.5px;
          color: var(--text-secondary);
        }
        .cat-row-name {
          font-family: var(--font-serif);
          font-size: 15px;
        }
        .cat-row-group { font-size: 12px; }
        @media (max-width: 720px) {
          .cat-pane {
            grid-template-columns: 1fr;
          }
          .cat-rail {
            display: flex;
            flex-direction: row;
            overflow-x: auto;
            overflow-y: hidden;
            border-right: none;
            border-bottom: 1px solid var(--border);
            padding-right: 0;
            padding-bottom: 8px;
            white-space: nowrap;
          }
          .cat-rail-item {
            white-space: nowrap;
            flex-shrink: 0;
          }
          .cat-row {
            grid-template-columns: 80px 1fr;
          }
          .cat-row-group { display: none; }
        }
      `}</style>
    </div>
  );
}

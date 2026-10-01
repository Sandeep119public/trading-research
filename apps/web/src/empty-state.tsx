import type { ReactNode } from "react";

/**
 * The one empty/placeholder presentation for the whole app: a centered card
 * with an (aria-hidden) glyph, a heading, one line of guidance, and optional
 * actions. Pure markup — what counts as "empty" is decided by the caller, so
 * the replay caption, the loading/error placeholder, and the backtest
 * no-run/zero-trade states cannot drift into three different looks.
 */
export function EmptyState({
  icon = "▶",
  title,
  body,
  actions,
  compact = false
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty-state empty-state--compact" : "empty-state"}>
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {body !== undefined && <p className="empty-state-body">{body}</p>}
      {actions !== undefined && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

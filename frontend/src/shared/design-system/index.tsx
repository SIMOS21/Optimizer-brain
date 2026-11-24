import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="v2-page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children && <div className="v2-page-description">{children}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="v2-empty">
      {title && <h2>{title}</h2>}
      {children && <div>{children}</div>}
      {action && <div className="actions">{action}</div>}
    </div>
  );
}
export function Skeleton({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="v2-skeleton" role="status">
      <span>{label}</span>
      <div aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger";
}) {
  return <span className={`v2-chip v2-chip-${tone}`}>{children}</span>;
}

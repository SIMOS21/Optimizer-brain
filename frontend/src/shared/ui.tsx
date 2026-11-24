import type { ReactNode } from "react";
import { canonical } from "../api/validation";
import { EmptyState, StatusChip } from "./design-system";

export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState>{children}</EmptyState>;
}
export function Status({ value }: { value?: string | null }) {
  return (
    <StatusChip tone={value === "PUBLISHED" ? "positive" : "neutral"}>
      {value || "Non renseigné"}
    </StatusChip>
  );
}
export function JsonView({
  value,
  title = "Document canonique",
}: {
  value: unknown;
  title?: string;
}) {
  return (
    <details>
      <summary>{title}</summary>
      <pre>{canonical(value)}</pre>
    </details>
  );
}

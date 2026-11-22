import type { ReactNode } from "react";
import { canonical } from "../api/validation";

export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Status({ value }: { value?: string | null }) {
  return (
    <span className={`badge ${value === "PUBLISHED" ? "published" : "draft"}`}>
      {value || "Non renseigné"}
    </span>
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

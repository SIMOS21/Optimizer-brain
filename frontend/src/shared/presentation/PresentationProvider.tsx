import { useMemo, useState, type ReactNode } from "react";
import { PresentationContext, type PresentationMode } from "./context";

export function PresentationProvider({ children }: { children: ReactNode }) {
  // Presentation only. No persistence, role mapping or API capability changes.
  const [mode, setMode] = useState<PresentationMode>("business");
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return (
    <PresentationContext.Provider value={value}>
      {children}
    </PresentationContext.Provider>
  );
}

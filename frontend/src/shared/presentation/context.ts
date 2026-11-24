import { createContext, useContext } from "react";

export type PresentationMode = "business" | "expert";
export const PresentationContext = createContext<{
  mode: PresentationMode;
  setMode: (mode: PresentationMode) => void;
} | null>(null);

export function usePresentation() {
  const value = useContext(PresentationContext);
  if (!value) throw new Error("Contexte de présentation absent.");
  return value;
}

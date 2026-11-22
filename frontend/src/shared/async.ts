import { useEffect, useMemo, useState } from "react";

export function useLoad<T>(
  load: () => Promise<T>,
  dependencies: readonly unknown[],
): { data?: T; error?: string; loading: boolean } {
  // Resource identity list is supplied explicitly by each caller of this hook.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const identity = useMemo(() => ({}), dependencies);
  const [state, set] = useState<{
    identity: object;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ identity, loading: true });
  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) set({ identity, data, loading: false });
      })
      .catch((error: unknown) => {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          set({
            identity,
            error:
              error instanceof Error ? error.message : "Échec du chargement.",
            loading: false,
          });
      });
    return () => {
      active = false;
    };
    // The caller supplies immutable resource identities, never credentials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  return state.identity === identity ? state : { loading: true };
}

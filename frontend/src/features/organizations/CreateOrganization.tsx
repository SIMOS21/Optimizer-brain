import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../../api/client";
import type { Organization } from "../../api/types";
import { ErrorNotice } from "../../shared/ui";

export function CreateOrganization({
  client,
  onCreated,
}: {
  client: ApiClient;
  onCreated: (organization: Organization) => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const sending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <details className="v2-create-organization">
      <summary>Créer une organisation</summary>
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending.current) return;
          sending.current = true;
          setBusy(true);
          setError(undefined);
          void client
            .request("/organizations", "OrganizationResponse", "POST", {
              key,
              name,
            })
            .then((item) => {
              if (alive.current) onCreated(item);
            })
            .catch((reason: unknown) => {
              if (alive.current)
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Création refusée.",
                );
            })
            .finally(() => {
              sending.current = false;
              if (alive.current) setBusy(false);
            });
        }}
      >
        <ErrorNotice message={error} />
        <label>
          Clé de l’organisation
          <input
            required
            pattern="[A-Za-z][A-Za-z0-9_]*"
            maxLength={100}
            disabled={busy}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label>
          Nom de l’organisation
          <input
            required
            maxLength={500}
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Créer l’espace
        </button>
      </form>
    </details>
  );
}

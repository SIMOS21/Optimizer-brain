import { useState } from "react";
import type { ApiClient } from "../../api/client";
import type { Artifact, Organization } from "../../api/types";
import { Empty } from "../../shared/ui";
import { StoredRun } from "../execution/DecisionCockpit";

export function History({
  client,
  organization,
  records,
}: {
  client: ApiClient;
  organization: Organization;
  records: Artifact[];
}) {
  const [selected, select] = useState("");
  const sorted = [...records].sort(
    (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
  );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">HISTORIQUE VÉRIFIÉ</span>
        <h1>Les résultats conservés</h1>
        <p>
          Les valeurs proviennent uniquement des runs stockés. Le lancement de
          calcul sera disponible en Phase 4C.
        </p>
      </div>
      {!records.length ? (
        <Empty>
          Aucun run enregistré pour cette organisation. Aucun indicateur n’est
          extrapolé.
        </Empty>
      ) : (
        <>
          <section className="panel">
            <label>
              Résultat à consulter
              <select
                aria-label="Résultat historique"
                value={selected}
                onChange={(event) => select(event.target.value)}
              >
                <option value="">Choisir un run</option>
                {sorted.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.status} · {record.id}
                  </option>
                ))}
              </select>
            </label>
          </section>
          {selected && (
            <StoredRun
              key={selected}
              client={client}
              org={organization.id}
              id={selected}
            />
          )}
        </>
      )}
    </>
  );
}

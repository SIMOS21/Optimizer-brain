import { useState } from "react";
import type { ApiClient } from "../../api/client";
import { useLoad } from "../../shared/async";
import { Skeleton, StatusChip } from "../../shared/design-system";
import { ErrorNotice } from "../../shared/ui";
import { usePresentation } from "../../shared/presentation/context";

/** Display a secured stored reference; never substitute a sample or scenario value. */
export function ScenarioReference({
  client,
  org,
  id,
  expectedHash,
}: {
  client: ApiClient;
  org: string;
  id: string;
  expectedHash?: string;
}) {
  const { mode } = usePresentation();
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.model(org, id),
    [client, org, id, revision],
  );
  if (loaded.loading)
    return <Skeleton label="Chargement de la référence publiée…" />;
  if (!loaded.data)
    return (
      <div>
        <ErrorNotice message={loaded.error} />
        <button type="button" onClick={() => setRevision((n) => n + 1)}>
          Réessayer la référence
        </button>
      </div>
    );
  const record = loaded.data;
  if (
    record.state !== "PUBLISHED" ||
    (expectedHash && record.content_hash !== expectedHash)
  )
    return (
      <ErrorNotice message="Référence non publiée ou incompatible avec l’empreinte attendue." />
    );
  return (
    <section
      className="scenario-reference"
      aria-label="Contexte de la référence"
    >
      <h3>{record.document.organization_model.model_name}</h3>
      <StatusChip>{record.state}</StatusChip>
      <p>
        Version {record.version} ·{" "}
        {new Date(record.created_at * 1000).toLocaleString("fr-FR")}
      </p>
      <p>Snapshot de référence : {record.data_snapshot_id}</p>
      {mode === "expert" && (
        <p>
          Modèle : {record.id} · empreinte : {record.content_hash} · graphe :{" "}
          {record.graph_snapshot_id}
        </p>
      )}
      <small>
        Cette référence reste immuable. Chaque scénario crée ses propres
        artefacts.
      </small>
    </section>
  );
}

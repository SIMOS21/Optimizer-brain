import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type { Artifact, Organization } from "../../api/types";
import { useLoad } from "../../shared/async";
import { EmptyState, Skeleton, StatusChip } from "../../shared/design-system";
import { ErrorNotice } from "../../shared/ui";
import { usePresentation } from "../../shared/presentation/context";

const GraphCanvas = lazy(() =>
  import("../graph/GraphCanvas").then((module) => ({
    default: module.GraphCanvas,
  })),
);

export function OrganizationMap({
  client,
  organization,
  records,
}: {
  client: ApiClient;
  organization: Organization;
  records: Artifact[];
}) {
  const { mode } = usePresentation();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const versions = [...records].sort(
    (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
  );
  const selected =
    versions.find((item) => item.id === selectedId) ||
    versions.find((item) => item.state === "PUBLISHED") ||
    versions[0];
  const loaded = useLoad(
    () =>
      selected
        ? client.graph(organization.id, selected.id)
        : Promise.resolve(undefined),
    [client, organization.id, selected?.id, revision],
  );
  if (!selected)
    return (
      <EmptyState title="Aucune carte enregistrée">
        Importez un graphe autorisé ou préparez un premier snapshot. Aucun
        département ni ressource n’est inventé.
      </EmptyState>
    );
  return (
    <section
      className="organization-map-shell"
      aria-label="Snapshot de la carte"
    >
      <div className="panel map-version-picker">
        <label>
          Version de la carte
          <select
            aria-label="Version de la carte"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                Version {item.version} · {item.state}
                {mode === "expert" ? ` · ${item.id}` : ""}
              </option>
            ))}
          </select>
        </label>
        <p>
          La carte ouvre la dernière version publiée disponible, ou le dernier
          brouillon en l’absence de publication. Les autres versions restent
          consultables ; chaque capacité appartient au snapshot sélectionné.
        </p>
        <div className="actions">
          <StatusChip>{selected.state}</StatusChip>
          <button
            type="button"
            onClick={() =>
              navigate(
                `/organizations/${organization.id}/graphs/${selected.id}`,
              )
            }
          >
            Consulter cette version
          </button>
        </div>
      </div>
      {loaded.loading ? (
        <Skeleton label="Chargement de la carte sélectionnée…" />
      ) : loaded.error ? (
        <div className="v2-retry-panel">
          <ErrorNotice message={loaded.error} />
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Réessayer la carte
          </button>
        </div>
      ) : loaded.data ? (
        <>
          <p className="map-snapshot-context">
            Snapshot déclaré :{" "}
            {loaded.data.document.graph.organization.data_snapshot_id} · version{" "}
            {loaded.data.version}
          </p>
          <Suspense
            fallback={<Skeleton label="Chargement de la carte interactive…" />}
          >
            <GraphCanvas
              key={`${organization.id}:${loaded.data.id}:${loaded.data.content_hash}`}
              document={loaded.data.document}
              mode={mode}
            />
          </Suspense>
        </>
      ) : (
        <EmptyState title="Carte indisponible">
          Cette version est absente ou inaccessible. Choisissez une autre
          version.
        </EmptyState>
      )}
    </section>
  );
}

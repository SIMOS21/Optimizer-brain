import { useState } from "react";
import { ApiClient, canPublish } from "../api/client";
import type { GraphArtifact, ModelArtifact, Organization } from "../api/types";
import { ErrorNotice } from "./ui";

export function Publish({
  client,
  organization,
  record,
  kind,
  onPublished,
}: {
  client: ApiClient;
  organization: Organization;
  record: GraphArtifact | ModelArtifact;
  kind: "graphs" | "model-versions";
  onPublished: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (record.state !== "DRAFT" || !canPublish(organization.role)) return null;
  async function publish() {
    setBusy(true);
    setError(undefined);
    try {
      await client.request(
        `/organizations/${organization.id}/${kind}/${record.id}/publish`,
        kind === "graphs" ? "GraphArtifactResponse" : "ModelArtifactResponse",
        "POST",
      );
      onPublished();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Publication refusée.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="publish">
      <ErrorNotice message={error} />
      {!confirm ? (
        <button className="primary" onClick={() => setConfirm(true)}>
          Publier cette version
        </button>
      ) : (
        <div
          className="notice"
          role="group"
          aria-label="Confirmation de publication"
        >
          <strong>
            Confirmer la publication de {record.key} · v{record.version} ?
          </strong>
          <p>
            Le contenu devient une référence publiée immuable. Cette action ne
            lance aucun calcul ni action opérationnelle.
          </p>
          <button
            disabled={busy}
            className="primary"
            onClick={() => void publish()}
          >
            Confirmer la publication
          </button>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            Annuler la publication
          </button>
        </div>
      )}
    </div>
  );
}

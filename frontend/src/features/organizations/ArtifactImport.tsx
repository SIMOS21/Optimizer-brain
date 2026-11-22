import { useState } from "react";
import { ApiClient, canBuild } from "../../api/client";
import type { Artifact, Organization } from "../../api/types";
import { decode, parsePrecise } from "../../api/validation";
import { ErrorNotice } from "../../shared/ui";

export function ArtifactImport({
  client,
  organization,
  kind,
  graphs = [],
  onSaved,
}: {
  client: ApiClient;
  organization: Organization;
  kind: "graphs" | "model-versions";
  graphs?: Artifact[];
  onSaved: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [graphId, setGraphId] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!canBuild(organization.role)) return null;
  const isGraph = kind === "graphs";
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const value = parsePrecise(raw);
      const body = isGraph
        ? decode("GraphCreate-Input", value)
        : {
            graph_snapshot_id: graphId,
            model: decode("OrganizationModel-Input", value),
          };
      const result = await client.request(
        `/organizations/${organization.id}/${kind}`,
        isGraph ? "GraphArtifactResponse" : "ModelArtifactResponse",
        "POST",
        body,
      );
      onSaved(result.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import refusé.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{isGraph ? "Ajouter un graphe" : "Ajouter un modèle"}</h2>
        <button onClick={() => setOpen(!open)}>
          {open
            ? "Fermer l’import"
            : isGraph
              ? "Importer un graphe JSON"
              : "Importer un modèle JSON"}
        </button>
      </div>
      {open && (
        <>
          <p>
            {isGraph
              ? "Document GraphCreate : graph et shared_parameters. Les départements doivent déjà être enregistrés ; la clé d’organisation doit être " +
                organization.key +
                "."
              : "Source OrganizationModel déjà assemblée : fragments, variables, contraintes HARD et objectif unique. Choisissez exactement son graphe publié."}
          </p>
          <ErrorNotice message={error} />
          {!isGraph && (
            <label>
              Graphe publié de l’import
              <select
                value={graphId}
                onChange={(event) => setGraphId(event.target.value)}
              >
                <option value="">Choisir un graphe publié</option>
                {graphs
                  .filter((graph) => graph.state === "PUBLISHED")
                  .map((graph) => (
                    <option key={graph.id} value={graph.id}>
                      {graph.key} · v{graph.version}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Fichier JSON assemblé
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  setError("Le fichier dépasse 10 MiB.");
                  return;
                }
                void file
                  .text()
                  .then((content) => {
                    setRaw(content);
                    setError(undefined);
                  })
                  .catch(() => setError("Lecture du fichier impossible."));
              }}
            />
          </label>
          <label>
            Document JSON à importer
            <textarea
              rows={12}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="quiet">
            La validation et la compilation restent côté serveur. Aucun fichier
            référencé, code ou chemin système n’est exécuté. L’enregistrement
            crée un brouillon ; publier reste une action distincte.
          </p>
          <button
            disabled={busy || !raw.trim() || (!isGraph && !graphId)}
            className="primary"
            onClick={() => void save()}
          >
            {busy ? "Validation serveur…" : "Valider et enregistrer l’import"}
          </button>
        </>
      )}
    </section>
  );
}

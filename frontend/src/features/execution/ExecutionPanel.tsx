import { useEffect, useRef, useState } from "react";
import { ApiClient, ApiError, canBuild } from "../../api/client";
import type {
  Artifact,
  OptimizationJob,
  Organization,
  SolveSettings,
} from "../../api/types";
import { decode } from "../../api/validation";
import { ErrorNotice } from "../../shared/ui";

export function ExecutionPanel({
  client,
  organization,
  model,
  onSubmitted,
}: {
  client: ApiClient;
  organization: Organization;
  model: Artifact;
  onSubmitted: (job: OptimizationJob) => void;
}) {
  const [seconds, setSeconds] = useState("20");
  const [gap, setGap] = useState("0");
  const [nodes, setNodes] = useState("");
  const [presolve, setPresolve] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef<{ key: string; settings: SolveSettings } | null>(null);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const allowed =
    canBuild(organization.role) &&
    model.state === "PUBLISHED" &&
    model.organization_id === organization.id;
  async function submit() {
    if (!allowed || inFlight.current || completed.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (!pending.current) {
        const settings = decode("SolveSettings-Input", {
          time_limit_seconds: Number(seconds),
          mip_rel_gap: Number(gap),
          presolve,
          node_limit: nodes === "" ? null : Number(nodes),
        });
        pending.current = { key: crypto.randomUUID(), settings };
      }
      const result = await client.submitJob(
        organization.id,
        model.id,
        pending.current.settings,
        pending.current.key,
      );
      if (active.current) {
        completed.current = true;
        setSubmitted(true);
        pending.current = null;
        setUncertain(false);
        onSubmitted(result);
      }
    } catch (reason) {
      if (!active.current) return;
      const ambiguous =
        pending.current !== null &&
        !(
          reason instanceof ApiError &&
          [401, 403, 404, 409, 413, 422].includes(reason.status)
        );
      if (!ambiguous) pending.current = null;
      setUncertain(ambiguous);
      setError(
        reason instanceof Error ? reason.message : "Soumission indisponible.",
      );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="panel execution-panel">
      <span className="eyebrow">EXECUTION PANEL</span>
      <h2>Configurer la résolution</h2>
      <p>
        Le calcul utilise cette version publiée et son snapshot immuable. Les
        tolérances de vérification par défaut restent celles du backend.
      </p>
      {!allowed && (
        <p className="notice">
          Le lancement exige un modèle publié et le rôle ADMIN ou BUILDER.
        </p>
      )}
      <ErrorNotice message={error} />
      {uncertain && (
        <p role="status" className="notice">
          Réception non confirmée. Réessayez la même demande avec la même clé ;
          aucun nouveau calcul n’est créé si elle a déjà été reçue. Les
          paramètres restent verrouillés.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={!allowed || busy || uncertain || submitted}
          className="execution-settings"
        >
          <legend>Paramètres SolveSettings autorisés</legend>
          <label>
            Temps limite (secondes)
            <input
              required
              type="number"
              min="0"
              max="300"
              step="any"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
            />
          </label>
          <label>
            Gap relatif cible
            <input
              required
              type="number"
              min="0"
              max="1"
              step="any"
              value={gap}
              onChange={(event) => setGap(event.target.value)}
            />
          </label>
          <label>
            Limite de nœuds (facultative)
            <input
              type="number"
              min="0"
              max="2147483647"
              step="1"
              value={nodes}
              onChange={(event) => setNodes(event.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={presolve}
              onChange={(event) => setPresolve(event.target.checked)}
            />
            Activer le presolve
          </label>
        </fieldset>
        <p className="quiet">
          Un gap cible non nul autorise une optimalité à tolérance près. La
          limite de temps ne garantit pas l’obtention d’une solution.
        </p>
        <button
          className="primary"
          disabled={!allowed || busy || submitted}
          type="submit"
        >
          {submitted
            ? "Demande acceptée"
            : busy
              ? "Soumission…"
              : uncertain
                ? "Réessayer la même demande"
                : "Lancer l’optimisation"}
        </button>
      </form>
    </section>
  );
}

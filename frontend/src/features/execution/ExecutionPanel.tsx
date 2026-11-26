import { useEffect, useId, useRef, useState } from "react";
import { ApiClient, ApiError, canBuild } from "../../api/client";
import type {
  Artifact,
  OptimizationJob,
  Organization,
  SolveSettings,
} from "../../api/types";
import { decode } from "../../api/validation";
import { ErrorNotice } from "../../shared/ui";
import { Dialog } from "../../shared/design-system/Dialog";
import { usePresentation } from "../../shared/presentation/context";

export function ExecutionPanel({
  client,
  organization,
  model,
  onSubmitted,
  onLocked,
}: {
  client: ApiClient;
  organization: Organization;
  model: Artifact;
  onSubmitted: (job: OptimizationJob) => void;
  onLocked?: (locked: boolean) => void;
}) {
  const { mode } = usePresentation();
  const helpId = useId();
  const [confirming, setConfirming] = useState(false);
  const [prepared, setPrepared] = useState<SolveSettings | null>(null);
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
  useEffect(() => () => onLocked?.(false), [onLocked]);
  const allowed =
    canBuild(organization.role) &&
    model.state === "PUBLISHED" &&
    model.organization_id === organization.id;
  function prepare() {
    if (!allowed || inFlight.current || completed.current || confirming) return;
    if (uncertain) {
      void submit();
      return;
    }
    try {
      if (!seconds.trim() || !gap.trim())
        throw new Error("Les paramètres temps et gap sont obligatoires.");
      const settings = decode("SolveSettings-Input", {
        time_limit_seconds: Number(seconds),
        mip_rel_gap: Number(gap),
        presolve,
        node_limit: nodes === "" ? null : Number(nodes),
      });
      pending.current = { key: crypto.randomUUID(), settings };
      setPrepared(settings);
      setError(undefined);
      setConfirming(true);
      onLocked?.(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Paramètres invalides.",
      );
    }
  }
  function closeConfirmation() {
    if (inFlight.current) return;
    pending.current = null;
    setConfirming(false);
    onLocked?.(false);
  }
  async function submit() {
    if (
      !allowed ||
      !pending.current ||
      (!confirming && !uncertain) ||
      inFlight.current ||
      completed.current
    )
      return;
    inFlight.current = true;
    setConfirming(false);
    setBusy(true);
    setError(undefined);
    try {
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
        onLocked?.(false);
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
      if (!ambiguous) {
        pending.current = null;
        onLocked?.(false);
      }
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
      <span className="eyebrow">ÉTAPES 2 ET 3 · PARAMÈTRES ET LANCEMENT</span>
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
          prepare();
        }}
      >
        <fieldset
          disabled={!allowed || busy || confirming || uncertain || submitted}
          className="execution-settings"
        >
          <legend>
            {mode === "expert"
              ? "Paramètres SolveSettings autorisés"
              : "Réglages du calcul"}
          </legend>
          <label>
            Temps limite (secondes)
            <input
              aria-label="Temps limite (secondes)"
              aria-describedby={`${helpId}-time`}
              required
              type="number"
              min="0"
              max="300"
              step="any"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
            />
            <small id={`${helpId}-time`}>
              Budget de résolution en secondes ; aucune solution n’est garantie
              avant son expiration.
            </small>
          </label>
          <label>
            Gap relatif cible
            <input
              aria-label="Gap relatif cible"
              aria-describedby={`${helpId}-gap`}
              required
              type="number"
              min="0"
              max="1"
              step="any"
              value={gap}
              onChange={(event) => setGap(event.target.value)}
            />
            <small id={`${helpId}-gap`}>
              Écart relatif cible entre solution et borne : 0 demande de
              poursuivre la preuve, sans garantir son obtention.
            </small>
          </label>
          <label>
            Limite de nœuds (facultative)
            <input
              aria-label="Limite de nœuds (facultative)"
              aria-describedby={`${helpId}-nodes`}
              type="number"
              min="0"
              max="2147483647"
              step="1"
              value={nodes}
              onChange={(event) => setNodes(event.target.value)}
            />
            <small id={`${helpId}-nodes`}>
              Nombre maximal de nœuds de recherche MILP. Vide : limite non fixée
              dans cette demande.
            </small>
          </label>
          <label className="checkbox-label">
            <input
              aria-label="Activer le presolve"
              aria-describedby={`${helpId}-presolve`}
              type="checkbox"
              checked={presolve}
              onChange={(event) => setPresolve(event.target.checked)}
            />
            Activer le presolve
            <small id={`${helpId}-presolve`}>
              Simplifications internes du solveur, sans modification des
              contraintes approuvées.
            </small>
          </label>
        </fieldset>
        <p className="quiet">
          Un gap cible non nul autorise une optimalité à tolérance près. La
          limite de temps ne garantit pas l’obtention d’une solution.
        </p>
        {allowed && (
          <button
            className="primary"
            disabled={busy || confirming || submitted}
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
        )}
      </form>
      <Dialog
        open={confirming}
        title="Confirmer le lancement"
        onClose={closeConfirmation}
      >
        <p>
          Cette demande utilise le modèle {model.key}, version publiée{" "}
          {model.version}, et son snapshot enregistré. Vérifiez les paramètres
          avant de la transmettre au worker.
        </p>
        <dl className="execution-confirm-settings">
          <dt>Temps limite (secondes)</dt>
          <dd>{prepared?.time_limit_seconds}</dd>
          <dt>Gap relatif cible</dt>
          <dd>{prepared?.mip_rel_gap}</dd>
          <dt>Presolve</dt>
          <dd>{prepared?.presolve ? "Activé" : "Désactivé"}</dd>
          <dt>Limite de nœuds</dt>
          <dd>{prepared?.node_limit ?? "Non fixée"}</dd>
        </dl>
        <div className="actions">
          <button type="button" onClick={closeConfirmation}>
            Revenir aux paramètres
          </button>
          <button
            type="button"
            className="primary"
            disabled={!allowed || busy}
            onClick={() => void submit()}
          >
            Confirmer le lancement
          </button>
        </div>
      </Dialog>
    </section>
  );
}

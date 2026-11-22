import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiClient, canBuild } from "../../api/client";
import type { Organization } from "../../api/types";
import { ErrorNotice, JsonView } from "../../shared/ui";
import { useJobMonitor } from "./useJobMonitor";
import { StoredRun } from "./DecisionCockpit";

const errors: Record<string, string> = {
  WORKER_LEASE_EXPIRED:
    "Le bail du worker a expiré. Aucun résultat de cette tentative ne sera publié.",
  EXECUTION_TIMEOUT:
    "Le plafond d’exécution du processus a été atteint. Aucun run n’a été enregistré.",
  CHILD_EXITED_WITHOUT_RESULT:
    "Le processus s’est terminé sans résultat publiable.",
  PROCESS_START_FAILED: "Le processus de calcul n’a pas pu démarrer.",
  WORKER_SHUTDOWN: "Le worker a été arrêté avant la fin du calcul.",
  INVALID_JOB_SETTINGS: "Le paramétrage du job a été refusé.",
};
export function JobMonitor({
  client,
  organization,
  userId,
  id,
}: {
  client: ApiClient;
  organization: Organization;
  userId: string;
  id: string;
}) {
  const monitor = useJobMonitor(client, organization.id, id);
  const { job } = monitor;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef(true);
  const cancelling = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const canCancel =
    job &&
    ["QUEUED", "RUNNING"].includes(job.state) &&
    canBuild(organization.role) &&
    (organization.role === "ADMIN" || job.created_by === userId) &&
    !job.cancel_requested;
  async function cancel() {
    if (!canCancel || cancelling.current) return;
    cancelling.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await client.cancelJob(organization.id, id);
      if (active.current) monitor.refresh();
    } catch (reason) {
      if (active.current) {
        setError(
          reason instanceof Error ? reason.message : "Annulation indisponible.",
        );
        monitor.refresh();
      }
    } finally {
      cancelling.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <section className="panel job-monitor" aria-label="Suivi du job">
        <div className="section-title">
          <div>
            <span className="eyebrow">JOB MONITOR</span>
            <h2>État de l’exécution</h2>
          </div>
          <button onClick={monitor.refresh}>Actualiser le job</button>
        </div>
        <ErrorNotice message={monitor.error || error} />
        {!job && !monitor.error && (
          <p role="status">Consultation du job autorisé…</p>
        )}
        {job && (
          <>
            <div className="job-status" role="status">
              <span
                className={`job-state ${job.state.toLowerCase()}`}
                data-testid="job-state"
              >
                {job.state}
              </span>
              <span>
                Statut mathématique :{" "}
                <strong data-testid="job-solver-status">
                  {job.solver_status || "Non disponible"}
                </strong>
              </span>
            </div>
            <p className="quiet">
              Réponse reçue à {monitor.received}. Aucun pourcentage de
              progression n’est estimé.
            </p>
            {monitor.paused && (
              <p className="notice">
                Limite de consultations automatiques atteinte. Utilisez «
                Actualiser le job » pour reprendre.
              </p>
            )}
            {job.cancel_requested && job.state !== "CANCELLED" && (
              <p className="notice" role="status">
                Annulation demandée — arrêt non encore confirmé par le serveur.
              </p>
            )}
            {job.state === "CANCELLED" && (
              <p className="notice">
                Annulation confirmée par le serveur. Aucun run publié pour ce
                job.
              </p>
            )}
            {job.state === "FAILED" && (
              <p className="notice error">
                {errors[job.error_code || ""] ||
                  "Échec technique. Aucun résultat publiable disponible ; contactez l’administrateur avec l’identifiant du job."}
              </p>
            )}
            <dl>
              <dt>Job</dt>
              <dd>{job.id}</dd>
              <dt>Modèle publié</dt>
              <dd>
                <Link
                  to={`/organizations/${organization.id}/models/${job.model_version_id}`}
                >
                  {job.model_version_id}
                </Link>
              </dd>
              <dt>Créateur</dt>
              <dd>{job.created_by}</dd>
              <dt>Tentative</dt>
              <dd>{job.attempt_number}</dd>
              <dt>Début</dt>
              <dd>
                {job.started_at
                  ? new Date(job.started_at * 1000).toLocaleString("fr-FR")
                  : "Non démarré"}
              </dd>
              <dt>Fin</dt>
              <dd>
                {job.finished_at
                  ? new Date(job.finished_at * 1000).toLocaleString("fr-FR")
                  : "Non terminée"}
              </dd>
            </dl>
            {canCancel && (
              <button disabled={busy} onClick={() => void cancel()}>
                {busy ? "Demande en cours…" : "Demander l’annulation"}
              </button>
            )}
            <JsonView
              title="Paramètres enregistrés du job"
              value={job.settings}
            />
          </>
        )}
      </section>
      {job?.state === "SUCCEEDED" && job.run_id && (
        <StoredRun
          key={job.run_id}
          client={client}
          org={organization.id}
          id={job.run_id}
          expectedModel={job.model_version_id}
        />
      )}
    </>
  );
}

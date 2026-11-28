import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type { ExplanationSelection } from "../../api/types";
import { useLoad } from "../../shared/async";
import { ErrorNotice, JsonView } from "../../shared/ui";
import { usePresentation } from "../../shared/presentation/context";
import "../../styles/result-assistant.css";

type Props = { client: ApiClient; org: string; run: string; baseline?: string };
const availability = {
  DISABLED:
    "Assistant désactivé. Les résultats et calculs restent disponibles hors ligne.",
  MISSING_API_KEY:
    "Clé NVIDIA absente du serveur. Les résultats restent consultables.",
  NOT_AUTHORIZED:
    "Cet espace ou ce modèle n’est pas autorisé pour l’envoi externe de données.",
  READY:
    "NVIDIA disponible pour les artefacts publics ou synthétiques autorisés.",
};

export function ResultAssistant(props: Props) {
  // Selection changes unmount the complete conversation, consent and pending state.
  return (
    <AssistantSession
      key={`${props.org}:${props.run}:${props.baseline || ""}`}
      {...props}
    />
  );
}

function AssistantSession({ client, org, run, baseline }: Props) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<ExplanationSelection["intent"]>(
    baseline ? "COMPARISON" : "DECISIONS",
  );
  return (
    <aside
      className="panel result-assistant"
      aria-label="Assistant des résultats"
    >
      <h2>Assistant des résultats · facultatif</h2>
      <p>
        Explications guidées en français, à partir des artefacts revérifiés.
        Aucun droit de modification ou de résolution.
      </p>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Fermer l’assistant" : "Ouvrir l’assistant"}
      </button>
      {open && (
        <>
          <label>
            Question guidée
            <select
              value={intent}
              onChange={(e) =>
                setIntent(e.target.value as ExplanationSelection["intent"])
              }
            >
              <option value="DECISIONS">
                Explique-moi les décisions prises par le solveur.
              </option>
              <option value="RESOURCES">
                Pourquoi les ressources sont-elles saturées ?
              </option>
              {baseline && (
                <option value="COMPARISON">
                  Quelle différence existe entre ces scénarios ?
                </option>
              )}
            </select>
          </label>
          <Explanation
            key={intent}
            client={client}
            org={org}
            selection={{
              run_id: run,
              baseline_run_id: baseline || null,
              intent,
            }}
          />
        </>
      )}
    </aside>
  );
}

function Explanation({
  client,
  org,
  selection,
}: {
  client: ApiClient;
  org: string;
  selection: ExplanationSelection;
}) {
  const { mode } = usePresentation();
  const [consent, setConsent] = useState(false);
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const preview = useLoad(
    () => client.previewExplanation(org, selection),
    [
      client,
      org,
      selection.run_id,
      selection.baseline_run_id,
      selection.intent,
      revision,
    ],
  );
  const explanation = useLoad(() => {
    if (!attempt || !preview.data) return Promise.resolve(null);
    return client.explain(org, preview.data).finally(() => {
      inFlight.current = false;
    });
  }, [client, org, preview.data?.context_hash, attempt]);
  if (preview.loading)
    return <p role="status">Revérification des faits et préparation locale…</p>;
  if (!preview.data)
    return (
      <>
        <ErrorNotice message={preview.error} />
        <button onClick={() => setRevision((n) => n + 1)}>
          Réessayer les faits
        </button>
      </>
    );
  const data = preview.data;
  return (
    <>
      <p role="status">{availability[data.availability]}</p>
      <p>{data.disclosure}</p>
      <details>
        <summary>Données exactes proposées pour l’envoi externe</summary>
        <pre>{data.outbound_json}</pre>
      </details>
      <p>
        Prototype d’évaluation : ne pas autoriser de données confidentielles.
        Chaque essai consomme le quota de l’organisation, même en cas d’échec
        réseau.
      </p>
      <label className="assistant-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={!data.enabled || (!!attempt && explanation.loading)}
          onChange={(e) => setConsent(e.target.checked)}
        />
        J’autorise cet envoi de faits publics ou synthétiques à NVIDIA pour
        cette question.
      </label>
      <button
        disabled={
          !data.enabled || !consent || (!!attempt && explanation.loading)
        }
        onClick={() => {
          if (inFlight.current || !consent || !data.enabled) return;
          inFlight.current = true;
          setAttempt((n) => n + 1);
        }}
      >
        {attempt && explanation.loading
          ? "NVIDIA répond…"
          : attempt
            ? "Réessayer l’explication sans résoudre"
            : "Demander l’explication à NVIDIA"}
      </button>
      {attempt > 0 && explanation.error && (
        <ErrorNotice message={explanation.error} />
      )}
      {explanation.data && (
        <section aria-label="Explication contrôlée">
          <h3>Explication contrôlée</h3>
          <p className="notice">{explanation.data.warning}</p>
          {explanation.data.paragraphs.map((paragraph, i) => (
            <p key={explanation.data!.selected_fact_ids[i]}>{paragraph}</p>
          ))}
        </section>
      )}
      <details>
        <summary>Faits numériques revérifiés · source serveur</summary>
        <ul>
          {data.facts.map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
        </ul>
      </details>
      <h3>Artefacts consultés</h3>
      <ul>
        {data.references.map((ref, i) => (
          <li key={`${ref.run_id}:${i}`}>
            <Link
              to={`/organizations/${encodeURIComponent(org)}/history/${encodeURIComponent(ref.run_id)}`}
            >
              Résultat {i + 1} · {ref.public_status}
            </Link>
            {!ref.verified_plan && " · Aucun plan vérifié exploitable"}
          </li>
        ))}
      </ul>
      {mode === "expert" && (
        <JsonView
          title="Passerelle · diagnostics non sensibles"
          value={{
            provider: data.provider,
            model: data.model,
            schema_version: data.schema_version,
            context_hash: data.context_hash,
            references: data.references,
            presentation: "Sélection LLM ; rédaction serveur",
          }}
        />
      )}
    </>
  );
}

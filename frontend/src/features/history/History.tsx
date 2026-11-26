import { useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type { Artifact, Organization } from "../../api/types";
import { Empty } from "../../shared/ui";
import { StoredRun } from "../execution/DecisionCockpit";
import { PageHeader, EmptyState, Skeleton } from "../../shared/design-system";
import { usePresentation } from "../../shared/presentation/context";
import { useLoad } from "../../shared/async";
import { ErrorNotice } from "../../shared/ui";
import { HistoryCard } from "./HistoryCard";
import "../../styles/scenario-history.css";

export function History({
  client,
  organization,
  records,
}: {
  client: ApiClient;
  organization: Organization;
  records: Artifact[];
}) {
  const { mode } = usePresentation();
  const [selected, select] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [jobsRevision, setJobsRevision] = useState(0);
  const [jobsOffset, setJobsOffset] = useState(0);
  const authorized = records.filter(
    (r) => r.organization_id === organization.id,
  );
  const jobs = useLoad(
    () =>
      authorized.length
        ? client.jobs(organization.id, jobsOffset)
        : Promise.resolve({ items: [], limit: 50, offset: 0 }),
    [client, organization.id, !!authorized.length, jobsOffset, jobsRevision],
  );
  const sorted = [...authorized].sort(
    (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
  );
  const query = search
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .trim();
  const filtered = sorted.filter(
    (r) =>
      (!status || r.status === status) &&
      `${r.id} ${r.model_version_id || ""} ${r.data_snapshot_id || ""}`
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("fr")
        .includes(query),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 5) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 5, currentPage * 5 + 5);
  function resetFilters() {
    setPage(0);
    select("");
  }
  return (
    <div className="history-v2">
      <PageHeader
        eyebrow="DÉCISIONS ET HISTORIQUE"
        title="Les résultats conservés"
      >
        <p>
          Consultez chaque résultat avec son modèle, son scénario déclaré et sa
          vérification indépendante. Les valeurs proviennent des artefacts
          conservés.
        </p>
      </PageHeader>
      <p className="notice">
        Les comparaisons mathématiques et les gains entre scénarios ne sont pas
        disponibles (Phase 5B-3 hors périmètre).
      </p>
      {!authorized.length ? (
        <Empty>
          Aucun run enregistré pour cette organisation. Aucun indicateur n’est
          extrapolé.
        </Empty>
      ) : (
        <>
          <section
            className="panel history-filters"
            aria-label="Filtres de l’historique"
          >
            <label>
              Rechercher un run, un modèle ou un snapshot
              <input
                aria-label="Rechercher un run, un modèle ou un snapshot"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetFilters();
                }}
              />
            </label>
            <label>
              Statut mathématique enregistré
              <select
                aria-label="Filtrer le statut mathématique"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  resetFilters();
                }}
              >
                <option value="">Tous les statuts</option>
                {[...new Set(sorted.map((r) => r.status || ""))]
                  .filter(Boolean)
                  .sort()
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              La recherche porte sur les identifiants enregistrés. Un statut
              favorable seul n’atteste pas un plan vérifié.
            </p>
          </section>
          <section className="panel">
            <p className="quiet">
              Cet accès direct conserve tous les runs autorisés, indépendamment
              des filtres de la liste.
            </p>
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
                    {new Date(record.created_at * 1000).toLocaleString("fr-FR")}{" "}
                    · {record.status} · {record.id}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section
            className="history-results"
            aria-label="Résultats historiques"
          >
            {visible.map((record) => (
              <HistoryCard
                key={`${organization.id}:${record.id}`}
                client={client}
                org={organization.id}
                metadata={record}
                jobs={jobs.data?.items ?? []}
                jobsUnavailable={!!jobs.error}
                onSelect={select}
              />
            ))}
            {!visible.length && (
              <EmptyState title="Aucun résultat pour ces filtres">
                Modifiez la recherche ou le statut. Aucun historique n’est
                supprimé.
              </EmptyState>
            )}
            <div className="actions">
              <button
                disabled={!currentPage}
                onClick={() => {
                  setPage(currentPage - 1);
                  select("");
                }}
              >
                Résultats précédents
              </button>
              <span role="status">
                Page {currentPage + 1} sur {lastPage + 1} · {filtered.length}{" "}
                résultats
              </span>
              <button
                disabled={currentPage >= lastPage}
                onClick={() => {
                  setPage(currentPage + 1);
                  select("");
                }}
              >
                Résultats suivants
              </button>
            </div>
          </section>
          <details className="panel history-job-context">
            <summary>Origine des états techniques des jobs</summary>
            <p>
              Les états techniques proviennent uniquement de la page de jobs
              consultée, rapprochée par run et modèle. Une absence de lien reste
              « Non fourni » ; elle ne prouve pas SUCCEEDED.
            </p>
            {jobs.loading && <Skeleton label="Lecture des états techniques…" />}
            <ErrorNotice message={jobs.error} />
            <div className="actions">
              <button
                disabled={jobs.loading}
                onClick={() => setJobsRevision((n) => n + 1)}
              >
                Actualiser les états techniques
              </button>
              <button
                disabled={jobs.loading || !jobsOffset}
                onClick={() => setJobsOffset((n) => Math.max(0, n - 50))}
              >
                Jobs plus récents
              </button>
              <button
                disabled={jobs.loading || jobs.data?.items.length !== 50}
                onClick={() => setJobsOffset((n) => n + 50)}
              >
                Jobs plus anciens
              </button>
            </div>
            <Link to={`/organizations/${organization.id}/execution`}>
              Consulter toutes les exécutions
            </Link>
          </details>
          {selected && authorized.some((r) => r.id === selected) && (
            <StoredRun
              key={selected}
              client={client}
              org={organization.id}
              id={selected}
            />
          )}
          {mode === "expert" && (
            <p className="quiet">
              Organisation : {organization.id}. Les résumés lisent au plus cinq
              runs à la fois ; les détails complets restent accessibles par
              leurs URL.
            </p>
          )}
        </>
      )}
    </div>
  );
}

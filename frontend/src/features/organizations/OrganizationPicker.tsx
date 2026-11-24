import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Organization } from "../../api/types";
import { EmptyState, Skeleton, StatusChip } from "../../shared/design-system";
import { ErrorNotice } from "../../shared/ui";
import { usePresentation } from "../../shared/presentation/context";

const collator = new Intl.Collator("fr", {
  numeric: true,
  sensitivity: "base",
});
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr");
const PAGE_SIZE = 6;
export function OrganizationPicker({
  organizations,
  loading,
  error,
  onRetry,
  onSelect,
  autoFocus = false,
}: {
  organizations?: Organization[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelect: (organization: Organization) => void;
  autoFocus?: boolean;
}) {
  const { mode } = usePresentation();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState("asc");
  const [pages, setPages] = useState({ organizations: 0, tests: 0 });
  const groups = useMemo(() => {
    const needle = normalize(query.trim());
    const matching = (organizations ?? [])
      .filter((org) =>
        [org.name, org.key, org.id].some((value) =>
          normalize(value).includes(needle),
        ),
      )
      .sort(
        (a, b) =>
          (order === "asc" ? 1 : -1) * collator.compare(a.name, b.name) ||
          a.id.localeCompare(b.id),
      );
    return {
      organizations: matching.filter(
        (org) => !org.key.startsWith("studio_import_"),
      ),
      tests: matching.filter((org) => org.key.startsWith("studio_import_")),
    };
  }, [organizations, query, order]);
  function resetPages() {
    setPages({ organizations: 0, tests: 0 });
  }
  if (loading)
    return <Skeleton label="Chargement de vos organisations autorisées…" />;
  if (error)
    return (
      <>
        <ErrorNotice message={error} />
        <button onClick={onRetry}>Réessayer le chargement</button>
      </>
    );
  if (!organizations?.length)
    return (
      <EmptyState title="Aucune organisation disponible">
        Aucune appartenance active. Créez une organisation ou contactez votre
        administrateur.
      </EmptyState>
    );
  return (
    <section
      className="v2-organization-picker"
      aria-label="Annuaire des organisations"
    >
      <div className="v2-catalogue-tools">
        <label>
          Rechercher une organisation
          <input
            autoFocus={autoFocus}
            type="search"
            value={query}
            placeholder="Nom, clé ou identifiant"
            onChange={(event) => {
              setQuery(event.target.value);
              resetPages();
            }}
          />
        </label>
        <label>
          Trier les organisations
          <select
            value={order}
            onChange={(event) => {
              setOrder(event.target.value);
              resetPages();
            }}
          >
            <option value="asc">Nom : A à Z</option>
            <option value="desc">Nom : Z à A</option>
          </select>
        </label>
      </div>
      <div className="v2-catalogue-summary">
        <p className="v2-result-count" role="status">
          {groups.organizations.length + groups.tests.length} résultat(s) sur{" "}
          {organizations.length} organisation(s) autorisée(s).
        </p>
        <button
          type="button"
          className="v2-catalogue-refresh"
          onClick={onRetry}
        >
          Actualiser les organisations
        </button>
      </div>
      {!groups.organizations.length && !groups.tests.length && (
        <EmptyState title="Aucune organisation ne correspond">
          Essayez un autre nom ou effacez la recherche.
        </EmptyState>
      )}
      {(["organizations", "tests"] as const).map((group) => {
        const rows = groups[group];
        if (!rows.length) return null;
        const page = Math.min(
          pages[group],
          Math.ceil(rows.length / PAGE_SIZE) - 1,
        );
        const title =
          group === "tests" ? "Espaces de test" : "Vos organisations";
        return (
          <section className="v2-org-group" key={group} aria-label={title}>
            <div className="v2-group-heading">
              <h2>{title}</h2>
              <StatusChip>{rows.length}</StatusChip>
            </div>
            {group === "tests" && (
              <p>
                Identifiés par leur clé « studio_import_ ». Ces espaces et leurs
                données sont conservés et restent accessibles.
              </p>
            )}
            <ul className="v2-org-list">
              {rows
                .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                .map((org) => (
                  <li key={org.id}>
                    <Link
                      to={`/organizations/${org.id}`}
                      onClick={(event) => {
                        if (
                          event.button === 0 &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey &&
                          !event.altKey
                        ) {
                          event.preventDefault();
                          onSelect(org);
                        }
                      }}
                    >
                      <span className="v2-org-symbol" aria-hidden="true">
                        {org.name.slice(0, 1)}
                      </span>
                      <span className="v2-org-description">
                        <strong>{org.name}</strong>
                        {mode === "expert" && (
                          <small>
                            {org.key} · {org.id}
                          </small>
                        )}
                      </span>
                      <StatusChip>{org.role}</StatusChip>
                      <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
            </ul>
            {rows.length > PAGE_SIZE && (
              <nav
                className="v2-pagination"
                aria-label={`Pagination : ${title}`}
              >
                <button
                  disabled={!page}
                  onClick={() => setPages({ ...pages, [group]: page - 1 })}
                >
                  Précédent
                </button>
                <span>
                  Page {page + 1} sur {Math.ceil(rows.length / PAGE_SIZE)}
                </span>
                <button
                  disabled={(page + 1) * PAGE_SIZE >= rows.length}
                  onClick={() => setPages({ ...pages, [group]: page + 1 })}
                >
                  Suivant
                </button>
              </nav>
            )}
          </section>
        );
      })}
    </section>
  );
}

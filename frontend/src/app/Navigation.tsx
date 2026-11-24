import { NavLink } from "react-router-dom";
import { usePresentation } from "../shared/presentation/context";

const destinations = [
  { path: "", label: "Tableau de bord", icon: "grid" },
  { path: "/graphs", label: "Mon organisation", icon: "nodes" },
  { path: "/execution", label: "Optimisation", icon: "play" },
  { path: "/scenarios", label: "Scénarios", icon: "branch" },
  { path: "/history", label: "Décisions & historique", icon: "list" },
] as const;
function Icon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    nodes: "M4 4h6v6H4z M15 14h6v6h-6z M7 10v7h8 M17 4v10 M10 7h7",
    play: "M7 4l14 8-14 8z",
    branch: "M5 4v16 M5 8h7l6-4 M5 16h7l6 4",
    list: "M8 5h13 M8 12h13 M8 19h13 M3 5h1 M3 12h1 M3 19h1",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={paths[kind] || paths.list} />
    </svg>
  );
}
export function Navigation({
  organizationId,
  onNavigate,
}: {
  organizationId?: string;
  onNavigate?: () => void;
}) {
  const { mode } = usePresentation();
  const base = `/organizations/${organizationId}`;
  return (
    <nav aria-label="Navigation de l’organisation" className="v2-navigation">
      <span className="v2-nav-section">ESPACE DE DÉCISION</span>
      {destinations.map((item) =>
        organizationId ? (
          <NavLink
            key={item.path}
            to={base + item.path}
            end={!item.path}
            onClick={onNavigate}
          >
            <Icon kind={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ) : (
          <span
            className="v2-nav-disabled"
            key={item.path}
            aria-disabled="true"
          >
            <Icon kind={item.icon} />
            {item.label}
          </span>
        ),
      )}
      <span className="v2-nav-section">MODÉLISATION</span>
      {organizationId ? (
        <NavLink to={base + "/models"} onClick={onNavigate}>
          <Icon kind="list" />
          <span>
            {mode === "expert"
              ? "Modèles & contraintes"
              : "Modèles & validations"}
          </span>
        </NavLink>
      ) : (
        <span className="v2-nav-disabled" aria-disabled="true">
          <Icon kind="list" />
          Modèles & validations
        </span>
      )}
      <NavLink to="/" end onClick={onNavigate} className="v2-all-organizations">
        Toutes les organisations
      </NavLink>
    </nav>
  );
}

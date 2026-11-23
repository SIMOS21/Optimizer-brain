import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Organization, Schemas } from "../api/types";
import { Navigation } from "./Navigation";
import { Dialog } from "../shared/design-system/Dialog";
import { StatusChip } from "../shared/design-system";
import { usePresentation } from "../shared/presentation/context";

const roleNames: Record<Organization["role"], string> = {
  ADMIN: "Administrateur",
  BUILDER: "Concepteur",
  APPROVER: "Approbateur",
  VIEWER: "Lecteur",
};
export function AppShell({
  user,
  organization,
  loadingOrganization,
  onChooseOrganization,
  logout,
  children,
}: {
  user: Schemas["UserResponse"];
  organization?: Organization;
  loadingOrganization: boolean;
  onChooseOrganization: () => void;
  logout: () => void;
  children: ReactNode;
}) {
  const { mode, setMode } = usePresentation();
  const [menuOpen, setMenuOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      main.current?.focus({ preventScroll: true });
    }
  }, [pathname]);
  return (
    <div className="v2-app-shell" data-presentation-mode={mode}>
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <header className="v2-topbar">
        <button
          className="v2-menu-trigger"
          aria-label="Ouvrir le menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            aria-hidden="true"
            stroke="currentColor"
          >
            <path d="M3 5h18 M3 12h18 M3 19h18" />
          </svg>
        </button>
        <Link className="v2-brand" to="/">
          <span className="v2-logo">OB</span>
          <span>
            Optimization Brain<small>DECISION INTELLIGENCE STUDIO</small>
          </span>
        </Link>
        <button
          className="v2-org-trigger"
          aria-label="Changer d’organisation"
          aria-haspopup="dialog"
          onClick={onChooseOrganization}
        >
          <span>
            <small>ORGANISATION ACTIVE</small>
            <strong data-testid="active-organization">
              {loadingOrganization
                ? "Chargement de l’organisation…"
                : organization?.name || "Choisir une organisation"}
            </strong>
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div className="v2-presentation">
          <span>{mode === "business" ? "Mode métier" : "Mode expert"}</span>
          <button
            type="button"
            role="switch"
            aria-label="Mode expert"
            aria-checked={mode === "expert"}
            title="Change la présentation, pas vos autorisations"
            onClick={() => setMode(mode === "business" ? "expert" : "business")}
          >
            <i aria-hidden="true" />
          </button>
        </div>
        <div className="v2-user">
          <span>
            {user.display_name}
            {organization && (
              <small data-testid="active-role">
                {roleNames[organization.role]} · {organization.role}
              </small>
            )}
          </span>
          <button onClick={logout}>Déconnexion</button>
        </div>
      </header>
      <div className="v2-shell-body">
        <aside className="v2-sidebar">
          <Navigation organizationId={organization?.id} />
          <div className="v2-sidebar-footer">
            <strong>
              Une organisation.
              <br />
              Des décisions vérifiables.
            </strong>
            <p>Modèles versionnés et validation explicite.</p>
            {organization && (
              <StatusChip>{roleNames[organization.role]}</StatusChip>
            )}
            {mode === "expert" && organization && (
              <dl className="v2-expert-context">
                <dt>Clé de l’organisation</dt>
                <dd>{organization.key}</dd>
                <dt>Identifiant</dt>
                <dd>{organization.id}</dd>
              </dl>
            )}
          </div>
        </aside>
        <main
          ref={main}
          id="main-content"
          tabIndex={-1}
          className="content v2-content"
        >
          {children}
        </main>
      </div>
      <Dialog
        open={menuOpen}
        title="Navigation de l’organisation"
        className="v2-menu-dialog"
        onClose={() => setMenuOpen(false)}
      >
        <Navigation
          organizationId={organization?.id}
          onNavigate={() => setMenuOpen(false)}
        />
      </Dialog>
    </div>
  );
}

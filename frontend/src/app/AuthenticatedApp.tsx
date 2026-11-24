import { useState } from "react";
import { Route, Routes, useMatch, useNavigate } from "react-router-dom";
import { ApiClient } from "../api/client";
import type { Organization, Schemas } from "../api/types";
import { useLoad } from "../shared/async";
import { ErrorNotice } from "../shared/ui";
import { PageHeader, Skeleton, EmptyState } from "../shared/design-system";
import { Dialog } from "../shared/design-system/Dialog";
import { PresentationProvider } from "../shared/presentation/PresentationProvider";
import { OrganizationPicker } from "../features/organizations/OrganizationPicker";
import { CreateOrganization } from "../features/organizations/CreateOrganization";
import { Workspace } from "../features/organizations/Workspace";
import { AppShell } from "./AppShell";

type Props = {
  client: ApiClient;
  user: Schemas["UserResponse"];
  logout: () => void;
};
function AuthenticatedContent({ client, user, logout }: Props) {
  const [revision, setRevision] = useState(0);
  const [identityRevision, setIdentityRevision] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = useMatch("/organizations/:organizationId/*")?.params
    .organizationId;
  const navigate = useNavigate();
  const catalog = useLoad(() => client.organizations(), [client, revision]);
  // Resolve deep links independently of catalogue pagination/filtering. Its
  // identity guard clears the previous tenant in this very render.
  const active = useLoad(
    () =>
      selected ? client.organization(selected) : Promise.resolve(undefined),
    [client, selected, identityRevision],
  );
  function select(organization: Organization) {
    // Re-selecting the active tenant keeps its in-flight loads alive: their
    // identity is unchanged, so useLoad would not restart an aborted request.
    if (organization.id !== selected) client.abort();
    setPickerOpen(false);
    navigate(`/organizations/${organization.id}`);
  }
  const pickerProps = {
    organizations: catalog.data,
    loading: catalog.loading,
    error: catalog.error,
    onRetry: () => setRevision((n) => n + 1),
    onSelect: select,
  };
  return (
    <AppShell
      user={user}
      organization={active.data}
      loadingOrganization={!!selected && active.loading}
      onChooseOrganization={() => setPickerOpen(true)}
      logout={logout}
    >
      {selected ? (
        active.loading ? (
          <Skeleton label="Chargement de l’organisation autorisée…" />
        ) : active.data ? (
          <Routes>
            <Route
              path="/organizations/:organizationId/*"
              element={
                <Workspace
                  key={active.data.id}
                  client={client}
                  organizationId={active.data.id}
                  authorizedOrganization={active.data}
                  userId={user.id}
                />
              }
            />
          </Routes>
        ) : (
          <>
            <PageHeader title="Organisation inaccessible" />
            <ErrorNotice message={active.error} />
            <EmptyState>
              Cette organisation est absente ou ne fait plus partie de vos
              accès.
            </EmptyState>
            <div className="actions">
              <button onClick={() => setIdentityRevision((n) => n + 1)}>
                Réessayer
              </button>
              <button onClick={() => setPickerOpen(true)}>
                Choisir une autre organisation
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <PageHeader
            eyebrow="VOS ORGANISATIONS"
            title="Votre espace de décision"
          >
            <p>
              Retrouvez une organisation et accédez à ses modèles, ses
              ressources et ses décisions enregistrées.
            </p>
          </PageHeader>
          <OrganizationPicker {...pickerProps} />
          <CreateOrganization
            client={client}
            onCreated={(organization) => {
              setRevision((n) => n + 1);
              select(organization);
            }}
          />
        </>
      )}
      <Dialog
        open={pickerOpen}
        title="Choisir une organisation"
        onClose={() => setPickerOpen(false)}
      >
        <OrganizationPicker {...pickerProps} autoFocus />
      </Dialog>
    </AppShell>
  );
}
export function AuthenticatedApp(props: Props) {
  return (
    <PresentationProvider>
      <AuthenticatedContent {...props} />
    </PresentationProvider>
  );
}

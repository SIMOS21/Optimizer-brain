import { useEffect, useRef, useState } from "react";
import { ApiClient, ApiError, canBuild, canPublish } from "../../api/client";
import type {
  Artifact,
  Organization,
  ChangePolicy,
  PolicyCreate,
  ChangeTargetInfo,
  ControlledProposal,
  ControlledCommit,
  ChangePreview,
} from "../../api/types";
import { useLoad } from "../../shared/async";
import { ErrorNotice, JsonView, Status } from "../../shared/ui";

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "Action indisponible.";
}

function PolicyEditor({
  client,
  organization,
  model,
  onCreated,
}: {
  client: ApiClient;
  organization: Organization;
  model: Artifact;
  onCreated: () => void;
}) {
  const data = useLoad(
    async () => ({
      targets: await client.changeTargets(organization.id, model.id),
      members: await client.memberships(organization.id),
      departments: await client.departments(organization.id),
    }),
    [client, organization.id, model.id],
  );
  const [targetIndex, setTargetIndex] = useState("");
  const [key, setKey] = useState("");
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [domain, setDomain] = useState<"INTEGER" | "DECIMAL">("DECIMAL");
  const [department, setDepartment] = useState("");
  const [owner, setOwner] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useAlive();
  const sending = useRef(false);
  const captured = useRef<PolicyCreate | null>(null);
  const target: ChangeTargetInfo | undefined = data.data?.targets.items.find(
    (_, index) => String(index) === targetIndex,
  );
  const departmentKey = target?.owner_department || department;
  const registeredOwner = data.data?.departments.find(
    (d) => d.key === departmentKey,
  )?.owner_user_id;
  const ownerId = registeredOwner || owner;
  const locked = busy || uncertain || done;
  async function submit() {
    if (sending.current || done || !target || !ownerId) return;
    const body: PolicyCreate = captured.current ?? {
      key,
      version,
      name,
      reason,
      source_model_version_id: model.id,
      expected_source_content_hash: model.content_hash,
      rules: [
        {
          id: "authorized_value",
          target: target.target,
          operation: "SET",
          unit: target.unit,
          domain,
          minimum,
          maximum,
          owner_department: departmentKey,
          owner_user_id: ownerId,
          allowed_user_ids: users,
          approval: "OWNER_ACK_AND_PUBLICATION",
        },
      ],
    };
    captured.current = body;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await client.createPolicy(organization.id, body);
      if (alive.current) {
        setDone(true);
        setUncertain(false);
        captured.current = null;
        onCreated();
      }
    } catch (failure) {
      if (!alive.current) return;
      const rejected =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) captured.current = null;
      setUncertain(!rejected);
      setError(message(failure));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (data.loading)
    return <p role="status">Chargement des cibles autorisables…</p>;
  if (!data.data) return <ErrorNotice message={data.error} />;
  return (
    <form
      className="panel"
      data-testid="policy-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>Définir une politique de changement</h3>
      <p>
        Cette interface définit une règle par politique. Le responsable nommé
        doit donner son accord, puis ADMIN ou APPROVER doit publier la
        politique. La création seule n’accorde aucun droit.
      </p>
      <ErrorNotice message={error} />
      <fieldset disabled={locked}>
        <label>
          Cible autorisée
          <select
            required
            value={targetIndex}
            onChange={(e) => {
              setTargetIndex(e.target.value);
              setUsers([]);
              setOwner("");
              setDepartment("");
            }}
          >
            <option value="">Choisir un paramètre ou une capacité</option>
            {data.data.targets.items.map((t, i) => (
              <option key={i} value={String(i)}>
                {t.target.kind} · {t.target.path} · {t.unit}
              </option>
            ))}
          </select>
        </label>
        {target && (
          <p>
            Valeur de référence :{" "}
            <strong>
              {target.value} {target.unit}
            </strong>
            . Opération SET uniquement ; unité conservée.
          </p>
        )}
        <label>
          Clé de politique
          <input
            required
            pattern="[A-Za-z][A-Za-z0-9_]*"
            maxLength={100}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label>
          Version de politique
          <input
            required
            maxLength={500}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </label>
        <label>
          Nom de politique
          <input
            required
            maxLength={500}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Justification de politique
          <textarea
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label>
          Domaine autorisé
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value as "INTEGER" | "DECIMAL")}
          >
            <option value="DECIMAL">Décimal</option>
            <option value="INTEGER">Entier</option>
          </select>
        </label>
        <label>
          Valeur minimale autorisée
          <input
            required
            inputMode="decimal"
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
          />
        </label>
        <label>
          Valeur maximale autorisée
          <input
            required
            inputMode="decimal"
            value={maximum}
            onChange={(e) => setMaximum(e.target.value)}
          />
        </label>
        <label>
          Département responsable
          <select
            required
            disabled={!!target?.owner_department}
            value={departmentKey}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">Choisir un département</option>
            {data.data.departments.map((d) => (
              <option key={d.id} value={d.key}>
                {d.name} · {d.key}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsable nommé
          <select
            required
            disabled={!!registeredOwner}
            value={ownerId}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">Choisir un responsable actif</option>
            {data.data.members
              .filter(
                (m) =>
                  m.active && ["ADMIN", "BUILDER", "APPROVER"].includes(m.role),
              )
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id} · {m.role}
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend>Délégataires explicitement autorisés</legend>
          {data.data.members
            .filter((m) => m.active && ["ADMIN", "BUILDER"].includes(m.role))
            .map((m) => (
              <label key={m.user_id}>
                <input
                  type="checkbox"
                  checked={users.includes(m.user_id)}
                  onChange={(e) =>
                    setUsers(
                      e.target.checked
                        ? [...users, m.user_id]
                        : users.filter((u) => u !== m.user_id),
                    )
                  }
                />
                {m.user_id} · {m.role}
              </label>
            ))}
        </fieldset>
      </fieldset>
      {uncertain && (
        <p className="notice">
          Réception incertaine : réessayez exactement la même politique.
        </p>
      )}
      <button type="submit" disabled={busy || done || !users.length}>
        {busy
          ? "Enregistrement…"
          : uncertain
            ? "Réessayer la même politique"
            : "Créer la politique en brouillon"}
      </button>
    </form>
  );
}

function ChangeForm({
  client,
  organization,
  userId,
  policy,
  onCreated,
}: {
  client: ApiClient;
  organization: Organization;
  userId: string;
  policy: ChangePolicy;
  onCreated: (id: string) => void;
}) {
  const [key, setKey] = useState("");
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [source, setSource] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<ChangePreview>();
  const alive = useAlive();
  const sending = useRef(false);
  const captured = useRef<ControlledCommit | null>(null);
  const locked = busy || !!preview || uncertain || done;
  const rules = policy.document.rules.filter((r) =>
    r.allowed_user_ids.includes(userId),
  );
  async function inspect() {
    if (sending.current || preview || done) return;
    const changes = rules
      .filter((r) => values[r.id]?.length)
      .map((r) => ({
        rule_id: r.id,
        operation: "SET" as const,
        unit: r.unit,
        value: values[r.id]!,
        source,
      }));
    const proposal: ControlledProposal = {
      key,
      version,
      name,
      reason,
      source_model_version_id: policy.document.source_model_version_id,
      expected_source_content_hash: policy.document.source_content_hash,
      policy_version_id: policy.id,
      expected_policy_content_hash: policy.content_hash,
      parent_scenario_id: parent.trim() || null,
      changes,
    };
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.previewChanges(organization.id, proposal);
      if (alive.current) {
        captured.current = {
          proposal,
          expected_preview_hash: result.preview_hash,
        };
        setPreview(result);
      }
    } catch (failure) {
      if (alive.current) setError(message(failure));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function create() {
    if (sending.current || done || !captured.current) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.commitChanges(
        organization.id,
        captured.current,
      );
      if (alive.current) {
        setDone(true);
        setUncertain(false);
        captured.current = null;
        onCreated(result.id);
      }
    } catch (failure) {
      if (!alive.current) return;
      const rejected =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500;
      setUncertain(!rejected);
      setError(message(failure));
      if (rejected) {
        captured.current = null;
        setPreview(undefined);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!rules.length)
    return (
      <p className="notice">
        Cette politique ne vous délègue aucune modification.
      </p>
    );
  return (
    <section className="panel" data-testid="controlled-form">
      <h3>Créer un scénario sous politique</h3>
      <p>
        Référence : {policy.document.source_model_version_id} · politique{" "}
        {policy.key} / {policy.version} · {policy.content_hash}
      </p>
      <ErrorNotice message={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void inspect();
        }}
      >
        <fieldset disabled={locked}>
          <label>
            Clé du scénario contrôlé
            <input
              required
              pattern="[A-Za-z][A-Za-z0-9_]*"
              maxLength={100}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label>
            Version du scénario contrôlé
            <input
              required
              maxLength={500}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <label>
            Nom du scénario contrôlé
            <input
              required
              maxLength={500}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Justification du scénario contrôlé
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            Parent publié facultatif — identifiant
            <input value={parent} onChange={(e) => setParent(e.target.value)} />
          </label>
          <p>
            Le serveur vérifie que le parent appartient à la même référence et à
            la même politique. Laisser vide pour partir de la référence.
          </p>
          <label>
            Source des hypothèses
            <input
              required
              maxLength={500}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          {rules.map((r) => (
            <label key={r.id}>
              Valeur proposée · {r.id} ({r.unit})
              <input
                aria-label={`Valeur proposée · ${r.id} (${r.unit})`}
                inputMode="decimal"
                value={values[r.id] || ""}
                onChange={(e) =>
                  setValues({ ...values, [r.id]: e.target.value })
                }
              />
              <span>
                SET · {r.domain} · [{r.minimum} ; {r.maximum}] {r.unit} ·{" "}
                {r.target.path} · responsable {r.owner_department} /{" "}
                {r.owner_user_id}
              </span>
            </label>
          ))}
          <p>
            Une valeur vide conserve la valeur héritée. Aucun chemin de
            contrainte n’est modifiable.
          </p>
        </fieldset>
        <button
          type="submit"
          disabled={locked || !rules.some((r) => values[r.id]?.length)}
        >
          Prévisualiser les changements
        </button>
      </form>
      {preview && (
        <section data-testid="change-preview">
          <h4>Prévisualisation validée par le serveur</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Règle / unité</th>
                  <th>Référence</th>
                  <th>Valeur précédente</th>
                  <th>Proposition</th>
                  <th>Source / auteur</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.rule_id}>
                    <td>
                      {c.rule_id} / {c.unit}
                    </td>
                    <td>{c.original_value}</td>
                    <td>{c.previous_value}</td>
                    <td>{c.proposed_value}</td>
                    <td>
                      {c.source} / {c.changed_by}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Contraintes concernées :{" "}
            {preview.affected_constraint_ids.join(", ") || "aucune"}. Objectif
            concerné : {preview.affects_objective ? "oui" : "non"}. Aucun calcul
            d’optimisation dans cette prévisualisation.
          </p>
          <p>
            Nouveau snapshot et nouveaux artefacts DRAFT. Publier le graphe,
            puis le modèle avant d’utiliser le worker existant.
          </p>
          <p>Empreinte de prévisualisation : {preview.preview_hash}</p>
          {uncertain && (
            <p className="notice">
              Réception incertaine : réessayez exactement la même création.
            </p>
          )}
          <button disabled={busy || done} onClick={() => void create()}>
            {busy
              ? "Enregistrement…"
              : uncertain
                ? "Réessayer la même création contrôlée"
                : "Confirmer la création contrôlée"}
          </button>
          <button
            disabled={busy || uncertain || done}
            onClick={() => {
              captured.current = null;
              setPreview(undefined);
            }}
          >
            Revenir aux hypothèses
          </button>
        </section>
      )}
    </section>
  );
}

export function ControlledScenarios({
  client,
  organization,
  userId,
  models,
  onCreated,
}: {
  client: ApiClient;
  organization: Organization;
  userId: string;
  models: Artifact[];
  onCreated: (id: string) => void;
}) {
  const [source, setSource] = useState("");
  const [policyId, setPolicy] = useState("");
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useAlive();
  const sending = useRef(false);
  const loaded = useLoad(
    () => client.policies(organization.id, offset),
    [client, organization.id, offset, revision],
  );
  const policies = loaded.data?.items ?? [];
  const selected = policies.find(
    (p) => p.id === policyId && p.usable && p.state === "PUBLISHED",
  );
  const model = models.find((m) => m.id === source && m.state === "PUBLISHED");
  async function action(
    policy: ChangePolicy,
    kind: "owner-approval" | "publish",
  ) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await client.policyAction(organization.id, policy, kind);
      if (alive.current) setRevision((r) => r + 1);
    } catch (failure) {
      if (alive.current) setError(message(failure));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section data-testid="controlled-studio">
      <h2>Hypothèses contrôlées</h2>
      <p>
        Les politiques explicites autorisent des changements de valeurs. La
        référence et les versions antérieures restent immuables.
      </p>
      {canBuild(organization.role) && (
        <details>
          <summary>Nouvelle politique de changement</summary>
          <label>
            Référence de la politique
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Choisir un modèle publié</option>
              {models
                .filter((m) => m.state === "PUBLISHED")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.key} · {m.version} · {m.id}
                  </option>
                ))}
            </select>
          </label>
          {model && (
            <PolicyEditor
              key={model.id}
              client={client}
              organization={organization}
              model={model}
              onCreated={() => setRevision((r) => r + 1)}
            />
          )}
        </details>
      )}
      <h3>Politiques et accords</h3>
      <button disabled={busy} onClick={() => setRevision((r) => r + 1)}>
        Actualiser les politiques
      </button>
      <ErrorNotice message={error || loaded.error} />
      {loaded.loading ? (
        <p role="status">Chargement des politiques…</p>
      ) : (
        policies.map((p) => (
          <article className="panel" key={p.id}>
            <h4>
              {p.document.name} · {p.key} / {p.version}
            </h4>
            <Status value={p.state} />
            <p>
              Auteur {p.created_by} · publication{" "}
              {p.published_by || "en attente"} · empreinte {p.content_hash}
            </p>
            <p>
              Accords enregistrés :{" "}
              {p.approvals.map((a) => a.user_id).join(", ") || "aucun"}.
              Disponibilité :{" "}
              {p.usable ? "utilisable" : p.unavailability_reasons.join(", ")}.
            </p>
            <ul>
              {p.document.rules.map((rule) => (
                <li key={rule.id}>
                  {rule.id} : SET {rule.target.path} · {rule.domain} · [
                  {rule.minimum} ; {rule.maximum}] {rule.unit} · responsable{" "}
                  {rule.owner_department} / {rule.owner_user_id} · délégataires{" "}
                  {rule.allowed_user_ids.join(", ")} · accord du responsable et
                  publication obligatoires.
                </li>
              ))}
            </ul>
            {p.state === "DRAFT" && (
              <div className="actions">
                {p.document.rules.some((r) => r.owner_user_id === userId) &&
                  !p.approvals.some((a) => a.user_id === userId) && (
                    <button
                      disabled={busy}
                      onClick={() => void action(p, "owner-approval")}
                    >
                      Donner mon accord de responsable
                    </button>
                  )}
                {canPublish(organization.role) && (
                  <button
                    disabled={busy}
                    onClick={() => void action(p, "publish")}
                  >
                    Publier la politique
                  </button>
                )}
              </div>
            )}
            <JsonView title="Règles et provenance de la politique" value={p} />
          </article>
        ))
      )}
      <div className="actions">
        <button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Politiques précédentes
        </button>
        <button
          disabled={policies.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Politiques suivantes
        </button>
      </div>
      {canBuild(organization.role) && (
        <>
          <label>
            Politique publiée à utiliser
            <select
              value={policyId}
              onChange={(e) => setPolicy(e.target.value)}
            >
              <option value="">
                Choisir une politique publiée et utilisable
              </option>
              {policies
                .filter((p) => p.state === "PUBLISHED" && p.usable)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.document.name} · {p.key} / {p.version}
                  </option>
                ))}
            </select>
          </label>
          {selected && (
            <ChangeForm
              key={selected.id}
              client={client}
              organization={organization}
              userId={userId}
              policy={selected}
              onCreated={onCreated}
            />
          )}
        </>
      )}
    </section>
  );
}

import type {
  Schemas,
  Page,
  Organization,
  Artifact,
  Department,
  GraphArtifact,
  ModelArtifact,
  RunArtifact,
  OptimizationJob,
  SolveSettings,
  Scenario,
  ScenarioCreate,
  ChangePolicy,
  PolicyCreate,
  ControlledProposal,
  ControlledCommit,
  ScenarioComparison,
} from "./types";
import { decode, parsePrecise } from "./validation";

const messages: Record<number, string> = {
  401: "Session expirée ou identifiants invalides. Reconnectez-vous.",
  403: "Votre rôle actuel ne permet pas cette action.",
  404: "Ressource absente ou inaccessible dans cette organisation.",
  409: "Conflit de version ou de demande idempotente. Consultez l’état enregistré avant de réessayer ; aucun écrasement.",
  413: "Document trop volumineux (limite serveur : 10 MiB).",
  422: "Document invalide : contrôlez références, unités, versions et champs obligatoires.",
};
export class ApiError extends Error {
  constructor(
    readonly status: number,
    code?: string,
  ) {
    super(
      (code && changeMessages[code]) ||
        messages[status] ||
        "Le service est indisponible. Réessayez.",
    );
  }
}
const changeMessages: Record<string, string> = {
  COMPARISON_INTEGRITY_CONFLICT:
    "L’intégrité ou la reconstruction des résultats historiques n’a pas pu être établie. Aucun écart n’est présenté.",
  UNIT_CHANGE_FORBIDDEN: "Le changement d’unité est interdit.",
  CHANGE_NOT_DELEGATED:
    "Cette règle ne vous délègue pas le droit de modifier la valeur.",
  CHANGE_OUT_OF_RANGE:
    "La valeur proposée dépasse les bornes autorisées par la politique.",
  INTEGER_REQUIRED: "Cette politique exige une valeur entière.",
  RULE_NOT_ALLOWED: "La modification ne figure pas dans la politique publiée.",
  POLICY_NOT_PUBLISHED:
    "La politique doit être publiée avant toute modification.",
  POLICY_AUTHORITY_REVOKED:
    "La politique n’est plus utilisable : une autorité ou une approbation est révoquée.",
  PREVIEW_CHANGED:
    "La prévisualisation a changé ; faites-la valider à nouveau.",
};
export class ApiClient {
  private token: string | null = null;
  private controllers = new Set<AbortController>();
  constructor(private onExpired: () => void = () => undefined) {}
  clear() {
    this.token = null;
    this.abort();
  }
  abort() {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
  }
  async request<K extends keyof Schemas>(
    path: string,
    schema: K,
    method = "GET",
    body?: unknown,
    options: { headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<Schemas[K]> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.controllers.add(controller);
    try {
      controller.signal.throwIfAborted();
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...options.headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        let code: string | undefined;
        if ([403, 409, 422].includes(response.status)) {
          // Only closed public codes are displayed. Never echo arbitrary server text.
          const detail = (await response.json().catch(() => null)) as {
            detail?: { code?: unknown };
          } | null;
          controller.signal.throwIfAborted();
          if (
            typeof detail?.detail?.code === "string" &&
            Object.hasOwn(changeMessages, detail.detail.code)
          )
            code = detail.detail.code;
        }
        if (response.status === 401 && this.token) {
          this.clear();
          this.onExpired();
        }
        throw new ApiError(response.status, code);
      }
      const value = parsePrecise(await response.text());
      controller.signal.throwIfAborted();
      return decode(schema, value);
    } catch (error) {
      if (controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (
        error instanceof ApiError ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        throw error;
      // Do not echo server bodies, URLs, credentials or transport exceptions.
      // eslint-disable-next-line preserve-caught-error -- Do not attach potentially private transport details.
      throw new Error(
        "Réponse indisponible ou incompatible avec le contrat API.",
      );
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }
  async login(username: string, password: string) {
    this.clear();
    const result = await this.request("/auth/login", "TokenResponse", "POST", {
      username,
      password,
    });
    this.token = result.access_token;
    return this.request("/auth/me", "UserResponse");
  }
  async logout() {
    // Logout returns no document, and the local session is always discarded.
    const token = this.token;
    this.clear();
    if (token) {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      return response?.status === 204 || response?.status === 401;
    }
    return true;
  }
  private async list<K extends keyof CollectionItems>(
    kind: K,
    organization?: string,
  ): Promise<CollectionItems[K][]> {
    const schemas = {
      organizations: "Page_OrganizationResponse_",
      departments: "Page_DepartmentResponse_",
      graphs: "Page_ArtifactResponse_",
      "model-versions": "Page_ArtifactResponse_",
      "optimization-runs": "Page_ArtifactResponse_",
    } as const;
    const path = organization
      ? `/organizations/${encodeURIComponent(organization)}/${kind}`
      : "/organizations";
    const all: unknown[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.request(
        `${path}?limit=100&offset=${offset}`,
        schemas[kind],
      );
      if (
        organization &&
        page.items.some(
          (item) =>
            "organization_id" in item && item.organization_id !== organization,
        )
      )
        throw new Error("Réponse incohérente avec l’organisation active.");
      all.push(...page.items);
      if (page.items.length < 100) break;
    }
    // Each kind is tied to one generated schema; every page was runtime validated.
    return all as CollectionItems[K][];
  }
  organizations(): Promise<Organization[]> {
    return this.list("organizations");
  }
  async organization(id: string): Promise<Organization> {
    const result = await this.request(
      `/organizations/${encodeURIComponent(id)}`,
      "OrganizationResponse",
    );
    if (result.id !== id)
      throw new Error("Organisation incompatible avec la route active.");
    return result;
  }
  departments(org: string): Promise<Department[]> {
    return this.list("departments", org);
  }
  artifacts(
    org: string,
    kind: "graphs" | "model-versions" | "optimization-runs",
  ): Promise<Artifact[]> {
    return this.list(kind, org);
  }
  graph(org: string, id: string): Promise<GraphArtifact> {
    return this.scoped(org, id, "graphs", "GraphArtifactResponse");
  }
  model(org: string, id: string): Promise<ModelArtifact> {
    return this.scoped(org, id, "model-versions", "ModelArtifactResponse");
  }
  run(org: string, id: string): Promise<RunArtifact> {
    return this.scoped(org, id, "optimization-runs", "RunArtifactResponse");
  }
  async compareRuns(
    org: string,
    baseline: string | null,
    candidate: string | null,
  ): Promise<ScenarioComparison> {
    const query = new URLSearchParams();
    if (baseline !== null) query.set("baseline_run_id", baseline);
    if (candidate !== null) query.set("candidate_run_id", candidate);
    let result: ScenarioComparison;
    try {
      result = await this.request(
        `/organizations/${encodeURIComponent(org)}/scenario-comparisons?${query}`,
        "ComparisonReport",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        throw new ApiError(409, "COMPARISON_INTEGRITY_CONFLICT");
      throw error;
    }
    if (
      result.organization_id !== org ||
      result.baseline_run_id !== baseline ||
      result.candidate_run_id !== candidate ||
      [result.baseline, result.candidate].some(
        (run, i) =>
          run !== null &&
          (run.organization_id !== org ||
            run.run_id !== (i === 0 ? baseline : candidate)),
      )
    )
      throw new Error(
        "Comparaison incompatible avec les résultats ou l’organisation sélectionnés.",
      );
    const sides = [result.baseline, result.candidate];
    const bothVerified = sides.every((run) => run?.verified_plan === true);
    const crossValues = [
      result.observed_objective_delta,
      result.oriented_objective_delta,
      result.objective_improvement,
      result.objective_improvement_percent,
      ...result.decisions.map((row) => row.delta),
      ...result.resources.flatMap((row) => [
        row.capacity_delta,
        row.consumption_delta,
        row.remaining_delta,
      ]),
      ...result.constraints.map((row) => row.slack_delta),
    ];
    if (
      ((!bothVerified ||
        !["COMPARABLE", "QUALIFIED"].includes(result.comparability)) &&
        crossValues.some((v) => v !== null)) ||
      (result.objective_improvement !== null &&
        (!result.same_model_and_snapshot ||
          result.comparability !== "COMPARABLE" ||
          result.claim !== "VERIFIED_OBJECTIVE_IMPROVEMENT")) ||
      (result.objective_improvement_percent !== null &&
        result.objective_improvement === null) ||
      sides.some(
        (run, side) =>
          run !== null &&
          ((run.verified_plan &&
            (run.verification.valid !== true ||
              run.verification.plan_feasible !== true ||
              run.objective_value === null ||
              !["OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL"].includes(
                run.public_status,
              ) ||
              !["OPTIMAL", "FEASIBLE", "TIME_LIMIT"].includes(
                run.native_status,
              ) ||
              (run.public_status === "OPTIMAL" &&
                run.native_status !== "OPTIMAL"))) ||
            (!run.verified_plan &&
              (run.objective_value !== null ||
                result.decisions.some(
                  (d) =>
                    (side === 0 ? d.baseline_value : d.candidate_value) !==
                    null,
                ) ||
                result.constraints.some((r) => {
                  const measurement = side === 0 ? r.baseline : r.candidate;
                  return (
                    measurement != null &&
                    (measurement.lhs !== null || measurement.slack !== null)
                  );
                }) ||
                result.resources.some((r) => {
                  const measurement = side === 0 ? r.baseline : r.candidate;
                  return (
                    measurement != null &&
                    (measurement.consumption !== null ||
                      measurement.remaining !== null)
                  );
                })))),
      )
    )
      throw new Error(
        "Qualification de comparaison incohérente : aucun résultat exploitable n’est affiché.",
      );
    return result;
  }
  async diagnostics(
    org: string,
    id: string,
    kind: "model-versions" | "optimization-runs",
  ) {
    const result = await this.request(
      `/organizations/${encodeURIComponent(org)}/${kind}/${encodeURIComponent(id)}/diagnostics`,
      "DiagnosticsResponse",
    );
    if (
      result.organization_id !== org ||
      result.id !== id ||
      result.artifact_kind !==
        (kind === "model-versions" ? "MODEL_VERSION" : "RUN") ||
      (kind === "model-versions" && result.model_version_id !== id)
    )
      throw new Error(
        "Réponse incohérente avec l'organisation ou l'artefact actif.",
      );
    return result;
  }
  private checkScenario(record: Scenario, org: string): Scenario {
    const document = record.document;
    if (
      record.organization_id !== org ||
      document.organization_id !== org ||
      record.id !== document.id ||
      record.key !== document.key ||
      record.version !== document.version ||
      record.created_by !== document.author_id ||
      record.model_version_id !== document.model_version_id ||
      record.source_model_version_id !== document.source_model_version_id
    )
      throw new Error(
        "Scénario incompatible avec l'organisation ou la provenance attendue.",
      );
    return record;
  }
  async scenarios(org: string, offset = 0) {
    const page = await this.request(
      `/organizations/${encodeURIComponent(org)}/scenarios?limit=50&offset=${offset}`,
      "Page_ScenarioResponse_",
    );
    page.items.forEach((item) => this.checkScenario(item, org));
    return page;
  }
  async scenario(org: string, id: string): Promise<Scenario> {
    const result = this.checkScenario(
      await this.request(
        `/organizations/${encodeURIComponent(org)}/scenarios/${encodeURIComponent(id)}`,
        "ScenarioResponse",
      ),
      org,
    );
    if (result.id !== id) throw new Error("Identité du scénario incompatible.");
    return result;
  }
  async createScenario(org: string, body: ScenarioCreate): Promise<Scenario> {
    const result = this.checkScenario(
      await this.request(
        `/organizations/${encodeURIComponent(org)}/scenarios`,
        "ScenarioResponse",
        "POST",
        body,
      ),
      org,
    );
    if (
      result.key !== body.key ||
      // Pydantic Text strips Unicode White_Space at the boundary. ECMAScript
      // trim differs (notably U+0085 and U+FEFF), so match the server's set.
      result.version !==
        body.version.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "") ||
      result.source_model_version_id !== body.source_model_version_id ||
      result.document.source_content_hash !== body.expected_source_content_hash
    )
      throw new Error("Scénario incompatible avec la demande de création.");
    return result;
  }
  async memberships(org: string) {
    const members: Schemas["MembershipResponse"][] = [];
    for (let offset = 0; ; offset += 100) {
      const result = await this.request(
        `/organizations/${encodeURIComponent(org)}/memberships?limit=100&offset=${offset}`,
        "Page_MembershipResponse_",
      );
      if (result.items.some((m) => m.organization_id !== org))
        throw new Error("Membres hors organisation.");
      members.push(...result.items);
      if (result.items.length < 100) return members;
    }
  }
  async changeTargets(org: string, model: string) {
    const result = await this.request(
      `/organizations/${encodeURIComponent(org)}/model-versions/${encodeURIComponent(model)}/scenario-targets`,
      "ChangeTargetsResponse",
    );
    if (
      result.organization_id !== org ||
      result.source_model_version_id !== model
    )
      throw new Error("Cibles hors référence.");
    return result;
  }
  private checkPolicy(record: ChangePolicy, org: string): ChangePolicy {
    const doc = record.document;
    if (
      record.organization_id !== org ||
      doc.organization_id !== org ||
      record.id !== doc.id ||
      record.key !== doc.key ||
      record.version !== doc.version ||
      record.created_by !== doc.author_id ||
      record.approvals.some(
        (a) => a.policy_content_hash !== record.content_hash,
      )
    )
      throw new Error(
        "Politique incompatible avec l’organisation ou sa provenance.",
      );
    return record;
  }
  async policies(org: string, offset = 0) {
    const result = await this.request(
      `/organizations/${encodeURIComponent(org)}/scenario-change-policies?limit=50&offset=${offset}`,
      "Page_ChangePolicyResponse_",
    );
    result.items.forEach((r) => this.checkPolicy(r, org));
    return result;
  }
  async createPolicy(org: string, body: PolicyCreate) {
    const result = this.checkPolicy(
      await this.request(
        `/organizations/${encodeURIComponent(org)}/scenario-change-policies`,
        "ChangePolicyResponse",
        "POST",
        body,
      ),
      org,
    );
    if (
      result.document.source_model_version_id !==
        body.source_model_version_id ||
      result.document.source_content_hash !==
        body.expected_source_content_hash ||
      result.key !== body.key ||
      result.version !==
        body.version.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")
    )
      throw new Error("Politique hors demande.");
    return result;
  }
  async policyAction(
    org: string,
    policy: ChangePolicy,
    action: "owner-approval" | "publish",
  ) {
    const result = this.checkPolicy(
      await this.request(
        `/organizations/${encodeURIComponent(org)}/scenario-change-policies/${encodeURIComponent(policy.id)}/${action}`,
        "ChangePolicyResponse",
        "POST",
        { expected_policy_content_hash: policy.content_hash },
      ),
      org,
    );
    if (result.id !== policy.id || result.content_hash !== policy.content_hash)
      throw new Error("Politique différente de la version approuvée.");
    return result;
  }
  async previewChanges(org: string, proposal: ControlledProposal) {
    const result = await this.request(
      `/organizations/${encodeURIComponent(org)}/controlled-scenarios/preview`,
      "ChangePreview",
      "POST",
      proposal,
    );
    if (
      result.organization_id !== org ||
      result.source_model_version_id !== proposal.source_model_version_id ||
      result.source_content_hash !== proposal.expected_source_content_hash ||
      result.policy_version_id !== proposal.policy_version_id ||
      result.policy_content_hash !== proposal.expected_policy_content_hash ||
      result.parent_scenario_id !== (proposal.parent_scenario_id ?? null)
    )
      throw new Error("Prévisualisation hors référence ou politique.");
    return result;
  }
  async commitChanges(org: string, body: ControlledCommit) {
    const result = this.checkScenario(
      await this.request(
        `/organizations/${encodeURIComponent(org)}/controlled-scenarios`,
        "ScenarioResponse",
        "POST",
        body,
      ),
      org,
    );
    const doc = result.document;
    if (
      doc.kind !== "CONTROLLED_CHANGES" ||
      doc.preview_hash !== body.expected_preview_hash ||
      doc.policy_version_id !== body.proposal.policy_version_id ||
      doc.policy_content_hash !== body.proposal.expected_policy_content_hash ||
      doc.source_content_hash !== body.proposal.expected_source_content_hash ||
      result.source_model_version_id !==
        body.proposal.source_model_version_id ||
      result.key !== body.proposal.key ||
      result.version !==
        body.proposal.version.replace(
          /^\p{White_Space}+|\p{White_Space}+$/gu,
          "",
        )
    )
      throw new Error("Scénario hors prévisualisation approuvée.");
    return result;
  }
  async jobs(org: string, offset = 0): Promise<Page<OptimizationJob>> {
    const page = await this.request(
      `/organizations/${encodeURIComponent(org)}/optimization-jobs?limit=50&offset=${offset}`,
      "Page_OptimizationJobResponse_",
    );
    if (page.items.some((item) => item.organization_id !== org))
      throw new Error("Réponse incohérente avec l’organisation active.");
    return page;
  }
  job(org: string, id: string, signal?: AbortSignal): Promise<OptimizationJob> {
    return this.scoped(
      org,
      id,
      "optimization-jobs",
      "OptimizationJobResponse",
      signal,
    );
  }
  async submitJob(
    org: string,
    model: string,
    settings: SolveSettings,
    key: string,
  ): Promise<OptimizationJob> {
    const job = await this.request(
      `/organizations/${encodeURIComponent(org)}/model-versions/${encodeURIComponent(model)}/optimization-jobs`,
      "OptimizationJobResponse",
      "POST",
      { settings: decode("SolveSettings-Input", settings) },
      { headers: { "Idempotency-Key": key } },
    );
    if (job.organization_id !== org || job.model_version_id !== model)
      throw new Error(
        "Réponse incohérente avec le modèle ou l’organisation active.",
      );
    return job;
  }
  async cancelJob(org: string, id: string): Promise<OptimizationJob> {
    const job = await this.request(
      `/organizations/${encodeURIComponent(org)}/optimization-jobs/${encodeURIComponent(id)}/cancel`,
      "OptimizationJobResponse",
      "POST",
    );
    if (job.organization_id !== org || job.id !== id)
      throw new Error(
        "Réponse incohérente avec le job ou l’organisation active.",
      );
    return job;
  }
  private async scoped<
    K extends
      | "GraphArtifactResponse"
      | "ModelArtifactResponse"
      | "RunArtifactResponse"
      | "OptimizationJobResponse",
  >(
    org: string,
    id: string,
    kind: string,
    schema: K,
    signal?: AbortSignal,
  ): Promise<Schemas[K]> {
    const record = await this.request(
      `/organizations/${encodeURIComponent(org)}/${kind}/${encodeURIComponent(id)}`,
      schema,
      "GET",
      undefined,
      { signal },
    );
    if (record.organization_id !== org || record.id !== id)
      throw new Error(
        "Réponse incohérente avec l’organisation ou la ressource active.",
      );
    return record;
  }
}
export function canBuild(role: Organization["role"]) {
  return role === "ADMIN" || role === "BUILDER";
}
export function canPublish(role: Organization["role"]) {
  return role === "ADMIN" || role === "APPROVER";
}
export type { Page };
type CollectionItems = {
  organizations: Organization;
  departments: Department;
  graphs: Artifact;
  "model-versions": Artifact;
  "optimization-runs": Artifact;
};

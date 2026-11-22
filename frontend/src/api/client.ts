import type {
  Schemas,
  Page,
  Organization,
  Artifact,
  Department,
  GraphArtifact,
  ModelArtifact,
  RunArtifact,
} from "./types";
import { decode, parsePrecise } from "./validation";

const messages: Record<number, string> = {
  401: "Session expirée ou identifiants invalides. Reconnectez-vous.",
  403: "Votre rôle actuel ne permet pas cette action.",
  404: "Ressource absente ou inaccessible dans cette organisation.",
  409: "Conflit de version. Rechargez puis créez une nouvelle version ; aucun écrasement.",
  413: "Document trop volumineux (limite serveur : 10 MiB).",
  422: "Document invalide : contrôlez références, unités, versions et champs obligatoires.",
};
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(messages[status] || "Le service est indisponible. Réessayez.");
  }
}
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
  ): Promise<Schemas[K]> {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        if (response.status === 401 && this.token) {
          this.clear();
          this.onExpired();
        }
        throw new ApiError(response.status);
      }
      return decode(schema, parsePrecise(await response.text()));
    } catch (error) {
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
  private async scoped<
    K extends
      "GraphArtifactResponse" | "ModelArtifactResponse" | "RunArtifactResponse",
  >(org: string, id: string, kind: string, schema: K): Promise<Schemas[K]> {
    const record = await this.request(
      `/organizations/${encodeURIComponent(org)}/${kind}/${encodeURIComponent(id)}`,
      schema,
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

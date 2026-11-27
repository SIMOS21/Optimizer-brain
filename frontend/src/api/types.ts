import type { components } from "./generated";

type Generated = components["schemas"];
type GeneratedGraph = Generated["GraphCreate-Output"];
export type GraphDocument = Omit<GeneratedGraph, "graph"> & {
  graph: Omit<GeneratedGraph["graph"], "resources" | "edges"> & {
    resources: (Omit<Generated["ResourceNode"], "shared_with"> & {
      shared_with: string[];
    })[];
    edges: Generated["DependencyEdge"][];
  };
};
export type GraphArtifact = Omit<
  Generated["GraphArtifactResponse"],
  "document"
> & { document: GraphDocument };
export type Schemas = Omit<
  Generated,
  "GraphCreate-Output" | "GraphArtifactResponse"
> & {
  "GraphCreate-Output": GraphDocument;
  GraphArtifactResponse: GraphArtifact;
};
export type Organization = Schemas["OrganizationResponse"];
export type Role = Organization["role"];
export type Department = Schemas["DepartmentResponse"];
export type Artifact = Schemas["ArtifactResponse"];
export type ModelArtifact = Schemas["ModelArtifactResponse"];
export type RunArtifact = Schemas["RunArtifactResponse"];
export type ScenarioComparison = Schemas["ComparisonReport"];
export type ComparedRun = Schemas["ComparedRun"];
export type ModelSource = Schemas["OrganizationModel-Output"];
export type Composition = Schemas["CompositionDocument"];
export type Json = Schemas["JsonValue"];
export type OptimizationJob = Schemas["OptimizationJobResponse"];
export type SolveSettings = Schemas["SolveSettings-Input"];
export type Diagnostics = Schemas["DiagnosticsResponse"];
export type Scenario = Schemas["ScenarioResponse"];
export type ScenarioCreate = Schemas["ScenarioCreate"];
export type ChangePolicy = Schemas["ChangePolicyResponse"];
export type PolicyCreate = Schemas["ChangePolicyCreate"];
export type ChangeTargetInfo = Schemas["ChangeTargetInfo"];
export type ControlledProposal = Schemas["ControlledProposal"];
export type ControlledCommit = Schemas["ControlledCommit"];
export type ChangePreview = Schemas["ChangePreview"];
export type Page<T> = { items: T[]; limit: number; offset: number };

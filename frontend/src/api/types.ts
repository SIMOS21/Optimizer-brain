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
export type ModelSource = Schemas["OrganizationModel-Output"];
export type Composition = Schemas["CompositionDocument"];
export type Json = Schemas["JsonValue"];
export type Page<T> = { items: T[]; limit: number; offset: number };

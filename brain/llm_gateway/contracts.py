"""Closed explanation contracts; model output carries references, never assertions."""

from typing import Literal

from pydantic import Field, field_validator, model_validator

from brain.kernel.schema import StrictModel

Intent = Literal["DECISIONS", "RESOURCES", "COMPARISON"]


class ExplanationSelection(StrictModel):
    run_id: str = Field(min_length=1, max_length=100)
    baseline_run_id: str | None = Field(default=None, min_length=1, max_length=100)
    intent: Intent = "DECISIONS"

    @model_validator(mode="after")
    def comparison_requires_pair(self) -> "ExplanationSelection":
        if self.intent == "COMPARISON" and self.baseline_run_id is None:
            raise ValueError("Une comparaison exige deux runs")
        return self


class ExplanationRequest(ExplanationSelection):
    context_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    consent_to_external_processing: Literal[True]

    @field_validator("consent_to_external_processing", mode="before")
    @classmethod
    def explicit_boolean_consent(cls, value: object) -> object:
        if value is not True:
            raise ValueError("Consentement booléen explicite requis")
        return value


class GroundedFact(StrictModel):
    id: str
    kind: Literal[
        "STATUS", "OBJECTIVE", "DECISION", "RESOURCE", "CONSTRAINT", "COMPARISON", "LIMIT"
    ]
    text: str
    # Only these aliases, closed categories and rational values leave the server.
    values: tuple[str, ...] = ()


class ArtifactReference(StrictModel):
    run_id: str
    content_hash: str
    model_version_id: str
    model_content_hash: str
    graph_snapshot_id: str
    data_snapshot_id: str
    verified_plan: bool
    public_status: str


class ExplanationPreview(StrictModel):
    schema_version: Literal["7A.1"] = "7A.1"
    organization_id: str
    selection: ExplanationSelection
    context_hash: str
    enabled: bool
    availability: Literal["READY", "DISABLED", "NOT_AUTHORIZED", "MISSING_API_KEY"]
    provider: Literal["NVIDIA_NIM"] = "NVIDIA_NIM"
    model: str
    facts: tuple[GroundedFact, ...]
    references: tuple[ArtifactReference, ...]
    outbound_json: str
    disclosure: str = (
        "Seuls les alias, catégories et valeurs du JSON ci-dessous sont envoyés à NVIDIA. "
        "Aucun nom, identifiant métier, auteur, document, question libre ou secret n’est transmis. "
        "Prototype réservé aux données synthétiques ou publiques explicitement autorisées."
    )


class ModelSelection(StrictModel):
    schema_version: Literal["7A.1"]
    fact_ids: tuple[str, ...] = Field(min_length=1, max_length=8)


class ExplanationResponse(StrictModel):
    schema_version: Literal["7A.1"] = "7A.1"
    organization_id: str
    context_hash: str
    provider: Literal["NVIDIA_NIM"] = "NVIDIA_NIM"
    model: str
    presentation: Literal["GROUNDED_SELECTION"] = "GROUNDED_SELECTION"
    selected_fact_ids: tuple[str, ...]
    paragraphs: tuple[str, ...]
    facts: tuple[GroundedFact, ...]
    references: tuple[ArtifactReference, ...]
    warning: str = (
        "Sélection de faits par le LLM, rédaction et chiffres contrôlés par le serveur. "
        "Aucune nouvelle preuve d’optimalité, causalité ou gain économique."
    )

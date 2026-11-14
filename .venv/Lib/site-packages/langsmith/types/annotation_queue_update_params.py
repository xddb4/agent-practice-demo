# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing import Dict, Union, Iterable, Optional
from typing_extensions import Literal, TypeAlias, TypedDict

from .missing_param import MissingParam
from .annotation_queue_rubric_item_schema_param import AnnotationQueueRubricItemSchemaParam

__all__ = ["AnnotationQueueUpdateParams", "EnableReservations", "Metadata", "NumReviewersPerItem", "ReservationMinutes"]


class AnnotationQueueUpdateParams(TypedDict, total=False):
    default_dataset: Optional[str]
    """Dataset that reviewed runs are added to by default."""

    description: Optional[str]
    """New description."""

    enable_reservations: EnableReservations
    """Whether a reviewer reserves a run while reviewing it, so others skip it."""

    metadata: Optional[Metadata]
    """Metadata to store on the queue. Replaces the existing metadata."""

    name: Optional[str]
    """New name for the queue."""

    num_reviewers_per_item: Optional[NumReviewersPerItem]
    """How many reviewers must review each run."""

    reservation_minutes: Optional[ReservationMinutes]
    """How long a reservation lasts, in minutes."""

    reviewer_access_mode: Optional[Literal["any", "assigned"]]
    """
    Who completes a run: any (one reviewer is enough) or assigned (every assigned
    reviewer must submit).
    """

    rubric_instructions: Optional[str]
    """Instructions shown to reviewers."""

    rubric_items: Optional[Iterable[AnnotationQueueRubricItemSchemaParam]]
    """Feedback keys reviewers fill in for each run."""


EnableReservations: TypeAlias = Union[bool, MissingParam]

Metadata: TypeAlias = Union[Dict[str, object], MissingParam]

NumReviewersPerItem: TypeAlias = Union[int, MissingParam]

ReservationMinutes: TypeAlias = Union[int, MissingParam]

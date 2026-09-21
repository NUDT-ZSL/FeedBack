"""Errors reported by the dependency descriptor parser."""

from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class ValidationIssue:
    location: str
    message: str

    def __str__(self) -> str:
        if self.location:
            return f"{self.location}: {self.message}"
        return self.message


class DescriptorParseError(ValueError):
    """Raised when a descriptor cannot be parsed or schema-validated."""

    def __init__(self, issues: List[ValidationIssue]):
        self.issues = issues
        super().__init__("; ".join(str(issue) for issue in issues))


"""Portable roof interchange types. Kept separate from processing implementation.

Load under a qualified package name, never as top-level `types` (the stdlib owns it).
"""
from typing import TypedDict, Literal, NotRequired

class LockFile(TypedDict):
    url: str
    sha256: str
    bytes: int
    archiveKey: str
    name: str

class Mesh(TypedDict):
    vertices: list[list[float]]
    triangles: list[list[int]]
    semantics: list[str]
    roofPatchIds: NotRequired[list[int]]

class Candidate(TypedDict):
    name: Literal['simplified','reference','retry','landmark']
    mesh: Mesh | None
    metrics: dict

class ProcessedBuilding(TypedDict):
    buildingId: str
    footprintHash: str
    method: Literal['lidar_aerial','lidar_only','landmark','footprint']
    mesh: Mesh | None
    selectedCandidate: str | None
    reason: str | None
    flags: list[str]
    candidates: list[Candidate]
    ground: dict | None
    archives: list[LockFile]
    followUp: NotRequired[dict]

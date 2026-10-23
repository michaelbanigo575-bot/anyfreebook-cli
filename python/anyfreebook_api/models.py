"""Typed models for the ANYFREEBOOK public API (v1).

Every model is a plain :mod:`dataclasses` dataclass, so it is easy to build,
compare, serialise and inspect. Each one also knows how to parse the raw
JSON object the API returns.

The API speaks ``camelCase``; these models speak ``snake_case`` and keep the
original payload available through :meth:`Model.from_dict`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

#: The three legal tiers the API assigns to every result.
TIER_DOWNLOAD = "download"
TIER_BORROW = "borrow"
TIER_UNVERIFIED = "unverified"

#: Every tier the API may return.
TIERS = (TIER_DOWNLOAD, TIER_BORROW, TIER_UNVERIFIED)


def _as_list(value: Any) -> List[Any]:
    """Return ``value`` as a list, tolerating ``None`` and scalars."""
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


def _as_optional_int(value: Any) -> Optional[int]:
    """Coerce ``value`` to ``int`` when it looks like one, else ``None``."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_optional_str(value: Any) -> Optional[str]:
    """Return ``value`` as a string, or ``None`` when it is empty/absent."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


@dataclass
class File:
    """A single downloadable file belonging to a title.

    A ``File`` only ever exists for a title whose tier is ``download``;
    ``borrow`` and ``unverified`` results carry no files at all.
    """

    format: str
    url: str
    bytes: Optional[int] = None
    label: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "File":
        data = data or {}
        return cls(
            format=str(data.get("format") or ""),
            url=str(data.get("url") or ""),
            bytes=_as_optional_int(data.get("bytes")),
            label=_as_optional_str(data.get("label")),
        )


@dataclass
class Link:
    """A human-facing link, e.g. "Read on Project Gutenberg"."""

    label: str
    url: str
    source: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Link":
        data = data or {}
        return cls(
            label=str(data.get("label") or ""),
            url=str(data.get("url") or ""),
            source=_as_optional_str(data.get("source")),
        )


@dataclass
class Book:
    """One search result.

    ``tier`` is the legal status of *this* result and is always one of
    ``download``, ``borrow`` or ``unverified``.
    """

    id: str
    title: str
    author: Optional[str] = None
    year: Optional[int] = None
    source: Optional[str] = None
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    tier: str = TIER_UNVERIFIED
    tier_reason: Optional[str] = None
    license: Optional[str] = None
    files: List[File] = field(default_factory=list)
    links: List[Link] = field(default_factory=list)
    url: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Book":
        data = data or {}
        tier = str(data.get("tier") or TIER_UNVERIFIED).strip().lower()
        if tier not in TIERS:
            tier = TIER_UNVERIFIED
        return cls(
            id=str(data.get("id") or ""),
            title=str(data.get("title") or ""),
            author=_as_optional_str(data.get("author")),
            year=_as_optional_int(data.get("year")),
            source=_as_optional_str(data.get("source")),
            source_type=_as_optional_str(data.get("sourceType")),
            source_url=_as_optional_str(data.get("sourceUrl")),
            tier=tier,
            tier_reason=_as_optional_str(data.get("tierReason")),
            license=_as_optional_str(data.get("license")),
            files=[File.from_dict(item) for item in _as_list(data.get("files"))],
            links=[Link.from_dict(item) for item in _as_list(data.get("links"))],
            url=_as_optional_str(data.get("url")),
        )

    @property
    def downloadable_files(self) -> List[File]:
        """Files that may actually be downloaded.

        Empty unless the tier is ``download`` — a ``borrow`` title needs a
        free Internet Archive account and a loan, and an ``unverified`` title
        has no confirmed free copy, so neither can be fetched as a file.
        """
        if self.tier != TIER_DOWNLOAD:
            return []
        return list(self.files)

    def download(self, dest_dir: str, file: Optional[File] = None) -> str:
        """Download this book into ``dest_dir`` and return the written path.

        Raises :class:`AnyfreebookError` when the tier is not ``download``,
        or when the API returned no file to fetch.
        """
        from .client import AnyfreebookError, download as _download

        if self.tier != TIER_DOWNLOAD:
            raise AnyfreebookError(
                'Refusing to download "{title}": its tier is "{tier}", not "download". '
                "{reason}".format(
                    title=self.title or self.id,
                    tier=self.tier,
                    reason=self.tier_reason or "",
                ).strip()
            )
        chosen = file or (self.files[0] if self.files else None)
        if chosen is None:
            raise AnyfreebookError(
                'Refusing to download "{title}": the API returned no file for it.'.format(
                    title=self.title or self.id
                )
            )
        return _download(chosen, dest_dir, tier=self.tier)


@dataclass
class ResolvedTitle:
    """The authoritative legal status of one specific title.

    Returned by :meth:`anyfreebook_api.Client.resolve`.
    """

    title: str
    author: Optional[str] = None
    tier: str = TIER_UNVERIFIED
    tier_reason: Optional[str] = None
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    license: Optional[str] = None
    files: List[File] = field(default_factory=list)
    links: List[Link] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "ResolvedTitle":
        data = data or {}
        tier = str(data.get("tier") or TIER_UNVERIFIED).strip().lower()
        if tier not in TIERS:
            tier = TIER_UNVERIFIED
        return cls(
            title=str(data.get("title") or ""),
            author=_as_optional_str(data.get("author")),
            tier=tier,
            tier_reason=_as_optional_str(data.get("tierReason")),
            source_type=_as_optional_str(data.get("sourceType")),
            source_url=_as_optional_str(data.get("sourceUrl")),
            license=_as_optional_str(data.get("license")),
            files=[File.from_dict(item) for item in _as_list(data.get("files"))],
            links=[Link.from_dict(item) for item in _as_list(data.get("links"))],
        )

    @property
    def downloadable_files(self) -> List[File]:
        """Files that may actually be downloaded (empty unless tier is ``download``)."""
        if self.tier != TIER_DOWNLOAD:
            return []
        return list(self.files)


@dataclass
class SearchResult:
    """The result of a search.

    ``partial`` is ``True`` when at least one upstream source failed to
    answer. A partial result set is **not** an empty result set: the results
    that did come back are still valid, the list is merely incomplete.
    Always check ``failed_sources`` and warn the user when ``partial`` is set.
    """

    query: str
    page: int = 1
    limit: int = 20
    total: int = 0
    count: int = 0
    sources: Dict[str, int] = field(default_factory=dict)
    failed_sources: List[str] = field(default_factory=list)
    partial: bool = False
    results: List[Book] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "SearchResult":
        data = data or {}
        raw_sources = data.get("sources")
        sources: Dict[str, int] = {}
        if isinstance(raw_sources, dict):
            for name, count in raw_sources.items():
                parsed = _as_optional_int(count)
                sources[str(name)] = parsed if parsed is not None else 0
        failed = [
            str(name)
            for name in _as_list(data.get("failedSources"))
            if str(name).strip()
        ]
        results = [Book.from_dict(item) for item in _as_list(data.get("results"))]
        page = _as_optional_int(data.get("page"))
        limit = _as_optional_int(data.get("limit"))
        total = _as_optional_int(data.get("total"))
        count = _as_optional_int(data.get("count"))
        return cls(
            query=str(data.get("query") or ""),
            page=page if page is not None else 1,
            limit=limit if limit is not None else len(results),
            total=total if total is not None else len(results),
            count=count if count is not None else len(results),
            sources=sources,
            failed_sources=failed,
            partial=bool(data.get("partial")) or bool(failed),
            results=results,
        )

    def downloadable(self) -> List[Book]:
        """Only the results whose tier is ``download``."""
        return [book for book in self.results if book.tier == TIER_DOWNLOAD]

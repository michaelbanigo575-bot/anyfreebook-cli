"""Python SDK for the ANYFREEBOOK public API (v1).

Search Project Gutenberg, Open Library, the Internet Archive, Google Books,
PubMed Central, DOAJ and LibriVox through one endpoint — and get the legal
status of every result, not just a link.

    from anyfreebook_api import Client

    client = Client()
    result = client.search("python", limit=5)
    for book in result.results:
        if book.tier == "download":
            print(book.title, book.files[0].url)

The SDK has no runtime dependencies: it uses the standard library only.
"""

from __future__ import annotations

from .client import (
    DEFAULT_BASE_URL,
    MAX_LIMIT,
    MAX_QUERY_LENGTH,
    MAX_TITLE_LENGTH,
    SOURCES,
    ApiError,
    AnyfreebookError,
    Client,
    NetworkError,
    RateLimitError,
    __version__,
    download,
)
from .models import (
    TIER_BORROW,
    TIER_DOWNLOAD,
    TIER_UNVERIFIED,
    TIERS,
    Book,
    File,
    Link,
    ResolvedTitle,
    SearchResult,
)

__all__ = [
    # Client
    "Client",
    # Models
    "Book",
    "File",
    "Link",
    "SearchResult",
    "ResolvedTitle",
    # Errors
    "AnyfreebookError",
    "ApiError",
    "RateLimitError",
    "NetworkError",
    # Helpers
    "download",
    # Constants
    "TIERS",
    "TIER_DOWNLOAD",
    "TIER_BORROW",
    "TIER_UNVERIFIED",
    "SOURCES",
    "DEFAULT_BASE_URL",
    "MAX_LIMIT",
    "MAX_QUERY_LENGTH",
    "MAX_TITLE_LENGTH",
    "__version__",
]

"""HTTP client for the ANYFREEBOOK public API (v1).

Standard library only: :mod:`urllib.request`, :mod:`urllib.parse`,
:mod:`urllib.error`, :mod:`json`, :mod:`dataclasses` and :mod:`typing`.
No third-party runtime dependencies.

The client is deliberately small. It builds URLs, sends them through a
*transport* seam, decodes JSON and turns HTTP failures into typed errors.
The transport is injectable so tests can run entirely offline.
"""

from __future__ import annotations

import datetime
import email.utils
import json
import os
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping as _AbcMapping
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from .models import (
    TIER_DOWNLOAD,
    Book,
    File,
    Link,
    ResolvedTitle,
    SearchResult,
)

__all__ = [
    "ApiError",
    "AnyfreebookError",
    "Client",
    "NetworkError",
    "RateLimitError",
    "download",
    "DEFAULT_BASE_URL",
    "SOURCES",
    "MAX_LIMIT",
    "MAX_QUERY_LENGTH",
    "MAX_TITLE_LENGTH",
]

__version__ = "0.1.0"

#: Public API base URL.
DEFAULT_BASE_URL = "https://anyfreebook.com/api/v1"

#: Default request timeout, in seconds.
DEFAULT_TIMEOUT = 20.0

#: Sources accepted by the ``source`` query parameter.
SOURCES = (
    "all",
    "local",
    "gutenberg",
    "openlibrary",
    "archive",
    "googlebooks",
    "pubmed",
    "doaj",
    "librivox",
)

#: Maximum ``page`` size accepted by the API.
MAX_LIMIT = 50

#: Maximum length of the ``q`` parameter.
MAX_QUERY_LENGTH = 200

#: Maximum length of the ``title`` parameter.
MAX_TITLE_LENGTH = 300

#: User agent sent with every request.
USER_AGENT = "anyfreebook-api-python/{0} (+https://anyfreebook.com)".format(__version__)

#: A transport is any callable ``(url, headers, timeout) -> (status, body)``.
#: It may optionally return a third element: a mapping of response headers.
Transport = Callable[[str, Mapping[str, str], float], Any]


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class AnyfreebookError(Exception):
    """Base class for every error raised by this SDK."""


class ApiError(AnyfreebookError):
    """The API answered with a non-2xx status."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = int(status)
        self.message = message


class RateLimitError(ApiError):
    """The API answered HTTP 429 (too many requests).

    ``retry_after`` holds the number of seconds from the ``Retry-After``
    response header, or ``None`` when the API did not send a usable value.
    """

    def __init__(self, status: int, message: str, retry_after: Optional[int] = None) -> None:
        super().__init__(status, message)
        self.retry_after = retry_after


class NetworkError(AnyfreebookError):
    """The API could not be reached at all."""


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------


def _default_transport(url: str, headers: Mapping[str, str], timeout: float) -> Tuple[int, str, Dict[str, str]]:
    """GET ``url`` with :mod:`urllib.request` and return ``(status, body, headers)``.

    HTTP error statuses are *returned*, not raised, so the client can turn
    them into the right exception type. Only connection-level problems raise.
    """
    request = urllib.request.Request(url, headers=dict(headers), method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
            status = getattr(response, "status", None) or response.getcode()
            return int(status), body, _headers_to_dict(response.headers)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:  # pragma: no cover - the body is best effort only
            body = ""
        return int(exc.code), body, _headers_to_dict(exc.headers)
    except urllib.error.URLError as exc:
        raise NetworkError(
            "Could not reach the ANYFREEBOOK API: {0}".format(exc.reason)
        ) from exc
    except OSError as exc:
        raise NetworkError(
            "Could not reach the ANYFREEBOOK API: {0}".format(exc)
        ) from exc


def _headers_to_dict(headers: Any) -> Dict[str, str]:
    """Normalise a message object or mapping into a plain ``dict``."""
    if headers is None:
        return {}
    if isinstance(headers, _AbcMapping):
        return {str(key): str(value) for key, value in headers.items()}
    items = getattr(headers, "items", None)
    if callable(items):
        try:
            return {str(key): str(value) for key, value in items()}
        except Exception:  # pragma: no cover - defensive only
            return {}
    return {}


def _normalize_response(raw: Any) -> Tuple[int, str, Dict[str, str]]:
    """Accept ``(status, body)`` or ``(status, body, headers)`` from a transport."""
    if isinstance(raw, (tuple, list)):
        parts = list(raw)
    else:
        raise NetworkError("The transport returned {0!r} instead of (status, body).".format(type(raw)))
    if len(parts) >= 3:
        status, body, headers = parts[0], parts[1], parts[2]
    elif len(parts) == 2:
        status, body = parts[0], parts[1]
        headers = {}
    else:
        raise NetworkError("The transport returned {0!r} instead of (status, body).".format(raw))
    try:
        status = int(status)
    except (TypeError, ValueError):
        raise NetworkError("The transport returned a non-numeric status: {0!r}".format(status))
    if body is None:
        body = ""
    elif not isinstance(body, str):
        body = str(body)
    return status, body, _headers_to_dict(headers)


# --------------------------------------------------------------------------
# Response helpers
# --------------------------------------------------------------------------


def _header(headers: Mapping[str, str], name: str) -> Optional[str]:
    """Look a header up case-insensitively."""
    if not headers:
        return None
    wanted = name.lower()
    for key, value in headers.items():
        if str(key).lower() == wanted:
            return value
    return None


def _parse_retry_after(value: Any) -> Optional[int]:
    """Parse a ``Retry-After`` header into a number of seconds."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return max(0, int(text))
    try:
        return max(0, int(round(float(text))))
    except (TypeError, ValueError):
        pass
    try:
        when = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    delta = (when - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
    return max(0, int(round(delta)))


def _message_from_body(body: str) -> str:
    """Pull the human-readable message out of an error body."""
    text = (body or "").strip()
    if not text:
        return ""
    try:
        data = json.loads(text)
    except ValueError:
        return text[:500]
    if isinstance(data, _AbcMapping):
        for key in ("error", "message"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return text[:500]


def _default_message(status: int) -> str:
    if status == 400:
        return "The API rejected the request (HTTP 400)."
    if status == 401:
        return (
            "The API rejected the API key (HTTP 401). No key is needed for the "
            "anonymous tier — try again without one."
        )
    if status == 429:
        return "Rate limited by the API (HTTP 429)."
    if status >= 500:
        return "The API failed to handle the request (HTTP {0}).".format(status)
    return "Unexpected API response (HTTP {0}).".format(status)


def _error_for(status: int, body: str, headers: Mapping[str, str]) -> ApiError:
    """Build the right exception for a non-2xx response."""
    message = _message_from_body(body) or _default_message(status)
    if status == 429:
        retry_after = _parse_retry_after(_header(headers, "retry-after"))
        return RateLimitError(status, message, retry_after=retry_after)
    return ApiError(status, message)


def _decode_json(status: int, body: str) -> Any:
    """Decode a JSON body, turning a malformed one into an :class:`ApiError`."""
    text = (body or "").strip()
    if not text:
        raise ApiError(status, "The API returned an empty response.")
    try:
        return json.loads(text)
    except ValueError as exc:
        raise ApiError(status, "The API returned a response that is not valid JSON.") from exc


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------


class Client:
    """A client for the ANYFREEBOOK public API (v1).

    :param base_url: API base URL. Defaults to the ``ANYFREEBOOK_API_BASE``
        environment variable, then to ``https://anyfreebook.com/api/v1``.
    :param api_key: Optional API key. Defaults to the
        ``ANYFREEBOOK_API_KEY`` environment variable. Pass an empty string to
        force anonymous access even when the variable is set.
    :param timeout: Request timeout in seconds (default 20).
    :param transport: Optional callable ``(url, headers, timeout)`` returning
        ``(status, body_text)`` — optionally ``(status, body_text, headers)``.
        Used by the tests to avoid the network entirely.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        transport: Optional[Transport] = None,
    ) -> None:
        resolved_base = base_url if base_url is not None else os.environ.get("ANYFREEBOOK_API_BASE")
        if not resolved_base:
            resolved_base = DEFAULT_BASE_URL
        self.base_url = str(resolved_base).strip().rstrip("/")

        if api_key is not None:
            self.api_key = str(api_key).strip()
        else:
            self.api_key = str(os.environ.get("ANYFREEBOOK_API_KEY") or "").strip()

        try:
            self.timeout = float(timeout)
        except (TypeError, ValueError):
            raise ValueError("timeout must be a number of seconds.")

        self.transport: Transport = transport if transport is not None else _default_transport

    # -- plumbing ---------------------------------------------------------

    def build_url(self, path: str, params: Optional[Mapping[str, Any]] = None) -> str:
        """Build a fully qualified URL for an API path."""
        url = "{0}/{1}".format(self.base_url, str(path).lstrip("/"))
        clean = {
            key: value
            for key, value in (params or {}).items()
            if value is not None and value != ""
        }
        if clean:
            url = "{0}?{1}".format(url, urllib.parse.urlencode(clean))
        return url

    def headers(self) -> Dict[str, str]:
        """Headers sent with every request. The key is only sent when present."""
        headers = {"accept": "application/json", "user-agent": USER_AGENT}
        if self.api_key:
            headers["authorization"] = "Bearer {0}".format(self.api_key)
        return headers

    def _request(self, path: str, params: Optional[Mapping[str, Any]] = None) -> Any:
        """Perform a GET request and return the decoded JSON body."""
        url = self.build_url(path, params)
        try:
            raw = self.transport(url, self.headers(), self.timeout)
        except NetworkError:
            raise
        except (urllib.error.URLError, OSError) as exc:
            raise NetworkError("Could not reach the ANYFREEBOOK API: {0}".format(exc)) from exc

        status, body, response_headers = _normalize_response(raw)
        if status < 200 or status >= 300:
            raise _error_for(status, body, response_headers)
        return _decode_json(status, body)

    # -- endpoints --------------------------------------------------------

    def search(
        self,
        q: str,
        page: int = 1,
        source: str = "all",
        limit: int = 20,
    ) -> SearchResult:
        """Search across the open-access sources.

        :param q: The search query (required, at most 200 characters).
        :param page: Page number, starting at 1.
        :param source: One of :data:`SOURCES` (default ``all``).
        :param limit: Results per page, 1 to 50 (default 20).

        The returned :class:`~anyfreebook_api.models.SearchResult` carries a
        ``partial`` flag. When it is ``True`` the source list in
        ``failed_sources`` did not answer, so the results are **incomplete,
        not empty**.
        """
        query = str(q or "").strip()
        if not query:
            raise ValueError("A search query is required.")
        if len(query) > MAX_QUERY_LENGTH:
            raise ValueError(
                "Query is {0} characters; the API accepts at most {1}.".format(
                    len(query), MAX_QUERY_LENGTH
                )
            )
        try:
            page_number = int(page)
        except (TypeError, ValueError):
            raise ValueError("page must be a whole number.")
        if page_number < 1:
            raise ValueError("page must be 1 or greater.")
        try:
            page_size = int(limit)
        except (TypeError, ValueError):
            raise ValueError("limit must be a whole number.")
        if page_size < 1 or page_size > MAX_LIMIT:
            raise ValueError("limit must be between 1 and {0}.".format(MAX_LIMIT))
        source_name = str(source or "all").strip().lower()
        if source_name not in SOURCES:
            raise ValueError(
                "Unknown source {0!r}. Valid sources: {1}.".format(source, ", ".join(SOURCES))
            )

        data = self._request(
            "search",
            {"q": query, "page": page_number, "source": source_name, "limit": page_size},
        )
        return SearchResult.from_dict(data)

    def resolve(self, title: str, author: Optional[str] = None) -> ResolvedTitle:
        """Resolve the legal status of one specific title.

        :param title: The title to resolve (required, at most 300 characters).
        :param author: Optional author, to disambiguate between editions.
        """
        name = str(title or "").strip()
        if not name:
            raise ValueError("A title is required.")
        if len(name) > MAX_TITLE_LENGTH:
            raise ValueError(
                "Title is {0} characters; the API accepts at most {1}.".format(
                    len(name), MAX_TITLE_LENGTH
                )
            )
        params: Dict[str, Any] = {"title": name}
        if author:
            author_name = str(author).strip()
            if author_name:
                params["author"] = author_name
        return ResolvedTitle.from_dict(self._request("resolve", params))

    def health(self) -> Dict[str, Any]:
        """Return the raw health payload, e.g. ``{"status": "ok", ...}``."""
        data = self._request("health", {})
        return data if isinstance(data, dict) else {"status": str(data)}


# --------------------------------------------------------------------------
# Downloading
# --------------------------------------------------------------------------


def _safe_filename(file: File) -> str:
    """Turn a file URL into a flat, filesystem-safe name.

    The URL's last path segment is the starting point. When it does not end
    with the declared format — Project Gutenberg, for example, serves
    ``1342.epub3.images`` for an EPUB — the name is trimmed to the format
    marker so the saved file keeps a sensible extension.
    """
    path = urllib.parse.urlparse(str(getattr(file, "url", "") or "")).path
    base = os.path.basename(path)
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-.")
    if not base:
        base = "download"

    fmt = str(getattr(file, "format", "") or "").strip().lower().lstrip(".")
    if fmt:
        suffix = "." + fmt
        lowered = base.lower()
        if not lowered.endswith(suffix):
            marker = lowered.find(suffix)
            if marker > 0:
                base = base[: marker + len(suffix)]
            elif "." in base:
                base = base.rsplit(".", 1)[0] + suffix
            else:
                base = base + suffix
    return base[:120]


def download(file: File, dest_dir: str, tier: str = TIER_DOWNLOAD) -> str:
    """Download ``file`` into ``dest_dir`` and return the written path.

    This refuses anything whose tier is not ``download`` — a ``borrow`` title
    needs a free Internet Archive account and a loan, and an ``unverified``
    title has no confirmed free copy, so neither may be fetched as a file.

    :param file: The :class:`~anyfreebook_api.models.File` to fetch.
    :param dest_dir: Directory to write into; created when missing.
    :param tier: The tier the file belongs to. Must be ``download``.
    """
    if str(tier or "").strip().lower() != TIER_DOWNLOAD:
        raise AnyfreebookError(
            "Refusing to download a file whose tier is {0!r}, not 'download'.".format(tier)
        )

    url = str(getattr(file, "url", "") or "").strip()
    if not url:
        raise AnyfreebookError("This file has no URL to download.")

    directory = os.path.abspath(os.path.expanduser(str(dest_dir)))
    os.makedirs(directory, exist_ok=True)
    destination = os.path.join(directory, _safe_filename(file))
    if os.path.commonpath([directory, os.path.abspath(destination)]) != directory:
        raise AnyfreebookError("Refused to write outside {0}.".format(directory))

    request = urllib.request.Request(
        url, headers={"user-agent": USER_AGENT, "accept": "*/*"}, method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT) as response:
            with open(destination, "wb") as handle:
                shutil.copyfileobj(response, handle)
    except urllib.error.HTTPError as exc:
        raise ApiError(
            int(exc.code),
            "The file host answered HTTP {0} for {1}.".format(int(exc.code), url),
        ) from exc
    except urllib.error.URLError as exc:
        raise NetworkError(
            "Could not reach the file host for {0}: {1}".format(url, exc.reason)
        ) from exc
    except OSError as exc:
        raise NetworkError("Could not reach the file host for {0}: {1}".format(url, exc)) from exc

    return destination

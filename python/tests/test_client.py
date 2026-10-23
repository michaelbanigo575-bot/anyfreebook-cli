"""Tests for the ANYFREEBOOK Python SDK.

Every test runs against a stub transport, so the suite never touches the
network. The stub replays canned ``(status, body)`` responses and records the
URL, headers and timeout it was called with, which is what most of the
assertions below check.
"""

from __future__ import annotations

import io
import json
import os
import sys
import urllib.error

import pytest

# Allow `pytest tests/` (not only `python -m pytest`) to import the package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anyfreebook_api import (  # noqa: E402
    ApiError,
    AnyfreebookError,
    Book,
    Client,
    File,
    NetworkError,
    RateLimitError,
    ResolvedTitle,
    SearchResult,
)
from anyfreebook_api.client import download  # noqa: E402

BASE = "https://anyfreebook.com/api/v1"


# --------------------------------------------------------------------------
# Stub transport
# --------------------------------------------------------------------------


class StubTransport:
    """Replay canned responses and record every call."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, headers, timeout):
        self.calls.append({"url": url, "headers": dict(headers), "timeout": timeout})
        if not self.responses:
            raise AssertionError("The stub transport ran out of canned responses.")
        return self.responses.pop(0)

    @property
    def last_url(self):
        return self.calls[-1]["url"]

    @property
    def last_headers(self):
        return self.calls[-1]["headers"]


def json_response(payload, status=200, headers=None):
    """Build a ``(status, body, headers)`` response for the stub transport."""
    return (status, json.dumps(payload), headers or {})


SEARCH_PAYLOAD = {
    "query": "python",
    "page": 1,
    "limit": 20,
    "total": 22537,
    "count": 2,
    "sources": {"Project Gutenberg": 120, "Open Library": 22417},
    "failedSources": [],
    "partial": False,
    "results": [
        {
            "id": "pg-39560",
            "title": "Fairy Circles",
            "author": "Villamaria",
            "year": None,
            "source": "Project Gutenberg",
            "sourceType": "gutenberg",
            "sourceUrl": "https://www.gutenberg.org/ebooks/39560",
            "tier": "download",
            "tierReason": "Verified public-domain full text on Project Gutenberg.",
            "license": "Public domain (Project Gutenberg)",
            "files": [
                {
                    "format": "epub",
                    "url": "https://www.gutenberg.org/ebooks/39560.epub3.images",
                    "bytes": None,
                    "label": "EPUB",
                }
            ],
            "links": [
                {
                    "label": "Read on Project Gutenberg",
                    "url": "https://www.gutenberg.org/ebooks/39560",
                    "source": "Project Gutenberg",
                }
            ],
            "url": "https://anyfreebook.com/book/fairy-circles-pg-39560",
        },
        {
            "id": "ol-clean-code",
            "title": "Clean Code",
            "author": "Robert C. Martin",
            "year": 2008,
            "source": "Open Library",
            "sourceType": "openlibrary",
            "sourceUrl": "https://openlibrary.org/works/OL45804W",
            "tier": "unverified",
            "tierReason": "No confirmed free, legal copy of this exact title was found.",
            "license": None,
            "files": [],
            "links": [],
            "url": "https://anyfreebook.com/book/clean-code-ol-clean-code",
        },
    ],
    "meta": {"apiVersion": "v1", "generatedAt": "2026-10-23T23:30:00.000Z"},
}

RESOLVE_PAYLOAD = {
    "title": "Pride and Prejudice",
    "author": "Jane Austen",
    "tier": "download",
    "tierReason": "Verified public-domain full text on Project Gutenberg.",
    "sourceType": "gutenberg",
    "sourceUrl": "https://www.gutenberg.org/ebooks/1342",
    "license": "Public domain",
    "files": [
        {
            "format": "epub",
            "url": "https://www.gutenberg.org/ebooks/1342.epub3.images",
            "bytes": None,
            "label": "EPUB",
        }
    ],
    "links": [
        {
            "label": "Read on Project Gutenberg",
            "url": "https://www.gutenberg.org/ebooks/1342",
            "source": "Project Gutenberg",
        }
    ],
    "meta": {"apiVersion": "v1", "generatedAt": "2026-10-23T23:30:00.000Z"},
}

HEALTH_PAYLOAD = {"status": "ok", "apiVersion": "v1", "uptimeSeconds": 1234}


def make_client(responses, **kwargs):
    """Build a Client wired to a stub transport."""
    transport = StubTransport(responses)
    client = Client(transport=transport, **kwargs)
    return client, transport


# --------------------------------------------------------------------------
# search
# --------------------------------------------------------------------------


def test_search_returns_typed_models():
    client, _ = make_client([json_response(SEARCH_PAYLOAD)])
    result = client.search("python")

    assert isinstance(result, SearchResult)
    assert result.query == "python"
    assert result.page == 1
    assert result.limit == 20
    assert result.total == 22537
    assert result.count == 2
    assert result.sources == {"Project Gutenberg": 120, "Open Library": 22417}
    assert result.failed_sources == []
    assert result.partial is False
    assert len(result.results) == 2


def test_search_maps_snake_case_fields():
    client, _ = make_client([json_response(SEARCH_PAYLOAD)])
    book = client.search("python").results[0]

    assert isinstance(book, Book)
    assert book.id == "pg-39560"
    assert book.title == "Fairy Circles"
    assert book.author == "Villamaria"
    assert book.year is None
    assert book.source == "Project Gutenberg"
    assert book.source_type == "gutenberg"
    assert book.source_url == "https://www.gutenberg.org/ebooks/39560"
    assert book.tier == "download"
    assert book.tier_reason == "Verified public-domain full text on Project Gutenberg."
    assert book.license == "Public domain (Project Gutenberg)"
    assert book.url == "https://anyfreebook.com/book/fairy-circles-pg-39560"

    assert isinstance(book.files[0], File)
    assert book.files[0].format == "epub"
    assert book.files[0].url == "https://www.gutenberg.org/ebooks/39560.epub3.images"
    assert book.files[0].bytes is None
    assert book.files[0].label == "EPUB"

    assert book.links[0].label == "Read on Project Gutenberg"
    assert book.links[0].source == "Project Gutenberg"


def test_search_builds_the_query_string():
    client, transport = make_client([json_response(SEARCH_PAYLOAD)])
    client.search("python", page=3, source="gutenberg", limit=5)

    url = transport.last_url
    assert url.startswith(BASE + "/search?")
    assert "q=python" in url
    assert "page=3" in url
    assert "source=gutenberg" in url
    assert "limit=5" in url


def test_search_encodes_special_characters():
    client, transport = make_client([json_response(SEARCH_PAYLOAD)])
    client.search("pride & prejudice")

    assert "pride+%26+prejudice" in transport.last_url


def test_search_sends_no_authorization_header_when_anonymous():
    client, transport = make_client([json_response(SEARCH_PAYLOAD)])
    client.search("python")

    assert "authorization" not in transport.last_headers
    assert transport.last_headers["accept"] == "application/json"


def test_search_sends_the_api_key_as_a_bearer_token():
    client, transport = make_client([json_response(SEARCH_PAYLOAD)], api_key="afb_test_key")
    client.search("python")

    assert transport.last_headers["authorization"] == "Bearer afb_test_key"


def test_client_reads_base_url_and_api_key_from_the_environment(monkeypatch):
    monkeypatch.setenv("ANYFREEBOOK_API_BASE", "https://example.test/api/v1")
    monkeypatch.setenv("ANYFREEBOOK_API_KEY", "afb_env_key")
    client, transport = make_client([json_response(SEARCH_PAYLOAD)])
    client.search("python")

    assert transport.last_url.startswith("https://example.test/api/v1/search?")
    assert transport.last_headers["authorization"] == "Bearer afb_env_key"


def test_an_explicit_empty_key_forces_anonymous_access(monkeypatch):
    monkeypatch.setenv("ANYFREEBOOK_API_KEY", "afb_env_key")
    client, transport = make_client([json_response(SEARCH_PAYLOAD)], api_key="")
    client.search("python")

    assert "authorization" not in transport.last_headers


def test_partial_results_are_flagged_and_listed():
    payload = dict(SEARCH_PAYLOAD)
    payload["failedSources"] = ["PubMed Central"]
    payload["partial"] = True
    client, _ = make_client([json_response(payload)])

    result = client.search("python")

    assert result.partial is True
    assert result.failed_sources == ["PubMed Central"]
    assert len(result.results) == 2  # incomplete, not empty


def test_failed_sources_imply_a_partial_result():
    payload = dict(SEARCH_PAYLOAD)
    payload["failedSources"] = ["DOAJ"]
    payload["partial"] = False
    client, _ = make_client([json_response(payload)])

    result = client.search("python")

    assert result.partial is True


# --------------------------------------------------------------------------
# resolve
# --------------------------------------------------------------------------


def test_resolve_returns_the_authoritative_status():
    client, _ = make_client([json_response(RESOLVE_PAYLOAD)])
    resolved = client.resolve("Pride and Prejudice", author="Jane Austen")

    assert isinstance(resolved, ResolvedTitle)
    assert resolved.title == "Pride and Prejudice"
    assert resolved.author == "Jane Austen"
    assert resolved.tier == "download"
    assert resolved.tier_reason == "Verified public-domain full text on Project Gutenberg."
    assert resolved.source_type == "gutenberg"
    assert resolved.source_url == "https://www.gutenberg.org/ebooks/1342"
    assert resolved.license == "Public domain"
    assert resolved.files[0].format == "epub"
    assert resolved.links[0].url == "https://www.gutenberg.org/ebooks/1342"


def test_resolve_sends_the_author_when_given():
    client, transport = make_client([json_response(RESOLVE_PAYLOAD)])
    client.resolve("Pride and Prejudice", author="Jane Austen")

    assert "title=Pride+and+Prejudice" in transport.last_url
    assert "author=Jane+Austen" in transport.last_url


def test_resolve_omits_the_author_when_not_given():
    client, transport = make_client([json_response(RESOLVE_PAYLOAD)])
    client.resolve("Pride and Prejudice")

    assert "author=" not in transport.last_url


# --------------------------------------------------------------------------
# health
# --------------------------------------------------------------------------


def test_health_returns_the_payload():
    client, transport = make_client([json_response(HEALTH_PAYLOAD)])
    payload = client.health()

    assert payload == HEALTH_PAYLOAD
    assert transport.last_url == BASE + "/health"


# --------------------------------------------------------------------------
# errors
# --------------------------------------------------------------------------


def test_a_400_raises_api_error():
    client, _ = make_client([json_response({"error": "q is required"}, status=400)])
    with pytest.raises(ApiError) as excinfo:
        client.search("python")

    assert excinfo.value.status == 400
    assert "q is required" in str(excinfo.value)


def test_a_401_raises_api_error():
    client, _ = make_client([json_response({"error": "Invalid API key."}, status=401)])
    with pytest.raises(ApiError) as excinfo:
        client.search("python")

    assert excinfo.value.status == 401


def test_a_429_raises_rate_limit_error_with_retry_after():
    client, _ = make_client(
        [
            json_response(
                {"error": "Too many requests."},
                status=429,
                headers={"Retry-After": "30"},
            )
        ]
    )
    with pytest.raises(RateLimitError) as excinfo:
        client.search("python")

    assert excinfo.value.status == 429
    assert excinfo.value.retry_after == 30
    assert isinstance(excinfo.value, ApiError)
    assert isinstance(excinfo.value, AnyfreebookError)


def test_a_429_without_a_retry_after_header_still_raises():
    client, _ = make_client([json_response({"error": "Too many requests."}, status=429)])
    with pytest.raises(RateLimitError) as excinfo:
        client.search("python")

    assert excinfo.value.retry_after is None


def test_a_500_raises_api_error():
    client, _ = make_client([json_response({"error": "Upstream exploded."}, status=500)])
    with pytest.raises(ApiError) as excinfo:
        client.search("python")

    assert excinfo.value.status == 500


def test_a_connection_failure_raises_network_error():
    def boom(url, headers, timeout):
        raise urllib.error.URLError("connection refused")

    client = Client(transport=boom)
    with pytest.raises(NetworkError):
        client.search("python")


def test_a_non_json_body_raises_api_error():
    client, _ = make_client([(200, "<html>not json</html>", {})])
    with pytest.raises(ApiError) as excinfo:
        client.search("python")

    assert "not valid JSON" in str(excinfo.value)


def test_an_empty_body_raises_api_error():
    client, _ = make_client([(200, "", {})])
    with pytest.raises(ApiError):
        client.search("python")


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------


def test_an_empty_query_is_rejected_before_any_request():
    client, transport = make_client([])
    with pytest.raises(ValueError):
        client.search("   ")
    assert transport.calls == []


def test_an_over_long_query_is_rejected():
    client, transport = make_client([])
    with pytest.raises(ValueError):
        client.search("x" * 201)
    assert transport.calls == []


def test_an_out_of_range_limit_is_rejected():
    client, _ = make_client([])
    with pytest.raises(ValueError):
        client.search("python", limit=51)


def test_an_unknown_source_is_rejected():
    client, _ = make_client([])
    with pytest.raises(ValueError):
        client.search("python", source="nope")


def test_an_empty_title_is_rejected():
    client, _ = make_client([])
    with pytest.raises(ValueError):
        client.resolve("")


# --------------------------------------------------------------------------
# tiers and downloading
# --------------------------------------------------------------------------


def test_downloadable_files_is_empty_for_a_non_download_tier():
    client, _ = make_client([json_response(SEARCH_PAYLOAD)])
    books = client.search("python").results

    assert books[0].tier == "download"
    assert len(books[0].downloadable_files) == 1
    assert books[1].tier == "unverified"
    assert books[1].downloadable_files == []


def test_download_refuses_a_file_whose_tier_is_not_download(tmp_path):
    file = File(format="epub", url="https://www.gutenberg.org/ebooks/1342.epub3.images")

    with pytest.raises(AnyfreebookError):
        download(file, str(tmp_path), tier="borrow")

    assert list(tmp_path.iterdir()) == []


def test_download_writes_the_bytes_to_disk(tmp_path, monkeypatch):
    payload = b"public-domain bytes"

    class FakeResponse:
        def __init__(self):
            self._buffer = io.BytesIO(payload)

        def read(self, size=-1):
            return self._buffer.read(size)

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    monkeypatch.setattr(
        "anyfreebook_api.client.urllib.request.urlopen",
        lambda request, timeout=None: FakeResponse(),
    )

    file = File(format="epub", url="https://www.gutenberg.org/ebooks/1342.epub3.images")
    destination = download(file, str(tmp_path / "books"))

    assert os.path.isfile(destination)
    assert destination.endswith("1342.epub")
    with open(destination, "rb") as handle:
        assert handle.read() == payload


def test_book_download_refuses_a_borrow_tier(tmp_path):
    client, _ = make_client([json_response(SEARCH_PAYLOAD)])
    books = client.search("python").results

    with pytest.raises(AnyfreebookError):
        books[1].download(str(tmp_path))


def test_book_download_writes_the_file(tmp_path, monkeypatch):
    class FakeResponse:
        def __init__(self):
            self._buffer = io.BytesIO(b"epub bytes")

        def read(self, size=-1):
            return self._buffer.read(size)

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    monkeypatch.setattr(
        "anyfreebook_api.client.urllib.request.urlopen",
        lambda request, timeout=None: FakeResponse(),
    )

    client, _ = make_client([json_response(SEARCH_PAYLOAD)])
    book = client.search("python").results[0]
    destination = book.download(str(tmp_path))

    assert os.path.isfile(destination)
    assert destination.endswith(".epub")

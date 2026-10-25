# anyfreebook-cli

**Search seven open-access book sources and download only what is verifiably public domain — from your terminal.**

```bash
anyfreebook download "pride and prejudice" --format epub
```

---

## Why this exists

Most "free book" APIs hand you a title and a link, and leave you to work out
whether the thing behind that link is actually free. Some are public domain.
Some are borrow-only loans you need an account for. Some are a catalogue
record for a book that is still under copyright.

This tool asks, per result, and tells you which one you have:

| tier | meaning | can you download it? |
| --- | --- | --- |
| `download` | A free, legally readable copy of this title. | **Yes**, when the API offers a file. A few sources are free to read but expose no file to fetch — the CLI says so instead of downloading nothing quietly. |
| `borrow` | A real copy, but borrow-only: a free Internet Archive account and a loan are required. | No. The CLI says so and points you at the loan page. |
| `unverified` | A catalogue record or a search page. No confirmed free copy of this exact title. | No. The CLI says so. |

The tier is never a guess. For the Internet Archive it comes from the item's
own metadata (`access-restricted-item` and `lending_identifier`); for Project
Gutenberg we only claim a download when the title and the author match a real
ebook and its id resolves to a real file.

The CLI will not download anything that is not `download`, and it never skips a
result silently — it tells you why.

---

## Install

The package is not on npm yet. Run it from a clone:

```bash
git clone https://github.com/michaelbanigo575-bot/anyfreebook-cli.git
cd anyfreebook-cli
npm install
npm link          # puts `anyfreebook` on your PATH
```

Or run it without installing:

```bash
node bin/anyfreebook.js search "python"
```

Once it is published to npm this becomes:

```bash
npm install -g anyfreebook-cli
npx anyfreebook-cli search "python"
```

Requires Node 18 or newer. No runtime dependencies.

---

## What it looks like

```console
$ anyfreebook search "pride and prejudice" --source gutenberg --limit 5

Query   pride and prejudice
Page    1 · limit 5 · 4 returned · 6 total matches
Sources Project Gutenberg 6

TITLE                                AUTHOR                        SOURCE             TIER      FORMATS
----------------------------------------------------------------------------------------------------
Pride and Prejudice                  Jane Austen                   Project Gutenberg  download  epub, txt, html
Pride and Prejudice                  Austen, Jane, 1775-1817       Project Gutenberg  download  epub, txt, html
Pride and Prejudice, a play founded  Steele, Mrs. MacKaye, Jane A  Project Gutenberg  download  epub, txt, html
  on Jane Austen's novel
Pride and Prejudice                  Jane Austen, R. W. Chapman     Project Gutenberg  download  epub, txt, html

More results available — use --page 2 for the next page.

download = verified public-domain full text · borrow = lending-restricted (needs a
free Internet Archive account + loan) · unverified = no confirmed free copy of this
exact title
```

And a download:

```console
$ anyfreebook download "pride and prejudice" --source gutenberg --format epub --limit 2

  ↓ pride-and-prejudice-pg-1342.epub   23.7 MB
  ✓ Pride and Prejudice — ./books/pride-and-prejudice-pg-1342.epub (23.7 MB)

Summary: downloaded 1 · skipped 0 · failed 0 · refused 0
```

When a source did not answer, the CLI says so rather than letting you think
you saw everything:

```console
$ anyfreebook search "python" --limit 5

! 1 source did not respond: Open Library. Results below are partial.

Query   python
...
```

---

## Quick start

```bash
# find books
anyfreebook search "python"

# only what is genuinely free to download
anyfreebook search "python" --free-only

# only one source
anyfreebook search "pride and prejudice" --source gutenberg

# only results that offer a specific format
anyfreebook search "python" --format epub

# download to disk (default folder: ./books)
anyfreebook download "pride and prejudice" --format epub --out ./books

# see what would happen, write nothing
anyfreebook download "pride and prejudice" --dry-run

# the careful answer for one title
anyfreebook resolve "Pride and Prejudice" --author "Jane Austen"

# machine-readable output
anyfreebook search "python" --json | jq '.results[] | select(.tier=="download") | .title'
```

---

## Commands

### `anyfreebook search <query>`

| Option | Default | Meaning |
| --- | --- | --- |
| `--limit <n>` | 10 | Results per page (max 50). |
| `--page <n>` | 1 | Page number. |
| `--source <name>` | `all` | `all`, `gutenberg`, `openlibrary`, `archive`, `googlebooks`, `pubmed`, `doaj`, `librivox`, `openalex`, `wikisource`, `europeana`, `zenodo`, `otl`. |
| `--format <fmt>` | — | Keep only results offering `epub`, `pdf`, `txt` or `html`. |
| `--free-only` | off | Keep only `tier === "download"` results. |
| `--json` | off | Print the raw JSON response to stdout and nothing else. |

### `anyfreebook download <query>`

| Option | Default | Meaning |
| --- | --- | --- |
| `--author <name>` | — | Resolve this exact title+author instead of searching. Recommended. |
| `--limit <n>` | 5 | Results to consider. |
| `--source <name>` | `all` | Same values as `search`. |
| `--format <fmt>` | best available | `epub` > `pdf` > `txt` > `html`. |
| `--out <dir>` | `./books` | Destination folder. |
| `--force` | off | Overwrite a file that already exists. |
| `--dry-run` | off | Show what would be downloaded; write nothing. |

Downloads are **always** restricted to `tier === "download"`. A `borrow` or
`unverified` result is reported as refused, with the reason — it is never
skipped quietly.

A result is only downloaded if its **own title** is the title you asked for.
The search fans out to sources that match free text, so "Pride and Prejudice"
also finds real academic papers about prejudice, and one of those can outrank
the novel and carry a perfectly good PDF. Those are reported and skipped, not
downloaded as if they were the book.

Pass `--author` when you know it. That resolves one exact title against the
real record instead of searching, which is both faster and unambiguous:

```bash
anyfreebook download "Pride and Prejudice" --author "Jane Austen" --format epub
```

File names are `<title-slug>-<source-id>.<ext>`, so two different books with
the same title do not overwrite each other.

### `anyfreebook resolve <title> [--author <name>]`

The authoritative answer for a single title. It checks the title and the author
against the real record, so a book by one Austen never resolves to a different
book that merely shares the surname — and a request for one title never comes
back with a different book attached.

```console
$ anyfreebook resolve "Pride and Prejudice" --author "Jane Austen"

Pride and Prejudice
Author   Jane Austen
Tier     download
Reason   Verified public-domain full text on Project Gutenberg.
License  Public domain
Source   https://www.gutenberg.org/ebooks/1342 (gutenberg)

Files (3)
  EPUB        https://www.gutenberg.org/ebooks/1342.epub3.images
  Plain text  https://www.gutenberg.org/ebooks/1342.txt.utf-8
  HTML        https://www.gutenberg.org/ebooks/1342.html.images
```

### `anyfreebook health`

```console
$ anyfreebook health

Status     ok
API ver    v1
Uptime     3h 12m
Base URL   https://anyfreebook.com/api/v1
```

### Global options

| Option | Environment variable | Default |
| --- | --- | --- |
| `--api-base <url>` | `ANYFREEBOOK_API_BASE` | `https://anyfreebook.com/api/v1` |
| `--api-key <key>` | `ANYFREEBOOK_API_KEY` | none — the anonymous tier works without one |
| `--timeout <ms>` | — | 20000 |
| `--json` | — | off |
| `--no-color` | `NO_COLOR` is honoured too | off |
| `--help`, `--version` | — | |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Request or usage error. |
| `2` | Rate limited (HTTP 429). The message says how long to wait. |

---

## Python SDK

The same API from Python, with **no dependencies** — standard library only.

```bash
pip install anyfreebook-api
```

```python
from anyfreebook_api import Client

client = Client()                       # base_url and api_key read from the environment
result = client.search("python", limit=5)

for book in result.results:
    if book.tier == "download":
        print(book.title, "->", book.files[0].url)

resolved = client.resolve("Pride and Prejudice", author="Jane Austen")
print(resolved.tier, resolved.tier_reason)
```

`Client(base_url=..., api_key=..., timeout=...)` — every argument is optional.
A `429` raises `RateLimitError` with `retry_after`; other failures raise
`ApiError`; a network failure raises `NetworkError`.

If `result.partial` is `True`, some sources did not answer — check
`result.failed_sources` before treating the list as complete.

---

## Use it in your app

```js
const res = await fetch('https://anyfreebook.com/api/v1/search?q=python&limit=5');
const data = await res.json();

for (const book of data.results) {
  if (book.tier === 'download') {
    console.log(book.title, book.files[0]?.url);
  }
}
```

```python
import json, urllib.request

url = "https://anyfreebook.com/api/v1/search?q=python&limit=5"
with urllib.request.urlopen(url) as r:
    data = json.load(r)

for book in data["results"]:
    if book["tier"] == "download":
        print(book["title"], book["files"][0]["url"])
```

---

## API reference

Base URL: `https://anyfreebook.com/api/v1`

### `GET /search`

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | — | **Required.** Max 200 characters. |
| `page` | integer | `1` | |
| `source` | string | `all` | `all`, `local`, `gutenberg`, `openlibrary`, `archive`, `googlebooks`, `pubmed`, `doaj`, `librivox`. |
| `limit` | integer | `20` | 1–50. |

```json
{
  "query": "python",
  "page": 1,
  "limit": 20,
  "total": 22537,
  "count": 20,
  "sources": { "Project Gutenberg": 120, "Open Library": 22417 },
  "failedSources": [],
  "partial": false,
  "results": [
    {
      "id": "pg-39560",
      "title": "Fairy Circles",
      "author": "Villamaria",
      "year": null,
      "source": "Project Gutenberg",
      "sourceType": "gutenberg",
      "sourceUrl": "https://www.gutenberg.org/ebooks/39560",
      "tier": "download",
      "tierReason": "Verified public-domain full text on Project Gutenberg.",
      "license": "Public domain (Project Gutenberg)",
      "files": [
        { "format": "epub", "url": "https://www.gutenberg.org/ebooks/39560.epub3.images", "bytes": null, "label": "EPUB" }
      ],
      "links": [
        { "label": "Read on Project Gutenberg", "url": "https://www.gutenberg.org/ebooks/39560", "source": "Project Gutenberg" }
      ],
      "url": "https://anyfreebook.com/book/fairy-circles-pg-39560"
    }
  ],
  "meta": { "apiVersion": "v1", "generatedAt": "2026-10-23T23:30:00.000Z" }
}
```

`failedSources` lists the sources that did not answer, and `partial` is `true`
when it is non-empty. A partial result set is **not** an empty result set.

`files` holds direct file URLs, and only when the file genuinely exists.
Project Gutenberg always offers EPUB, plain text and HTML for a valid ebook
id; a PDF is listed only when the source reported one.

### `GET /resolve`

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | **yes** | Max 300 characters. |
| `author` | string | no | Used to confirm the match. |

```json
{
  "title": "Pride and Prejudice",
  "author": "Jane Austen",
  "tier": "download",
  "tierReason": "Verified public-domain full text on Project Gutenberg.",
  "sourceType": "gutenberg",
  "sourceUrl": "https://www.gutenberg.org/ebooks/1342",
  "license": "Public domain",
  "files": [
    { "format": "epub", "url": "https://www.gutenberg.org/ebooks/1342.epub3.images", "bytes": null, "label": "EPUB" }
  ],
  "links": [
    { "label": "Read on Project Gutenberg", "url": "https://www.gutenberg.org/ebooks/1342", "source": "Project Gutenberg" }
  ],
  "meta": { "apiVersion": "v1", "generatedAt": "2026-10-23T23:30:00.000Z" }
}
```

### `GET /health`

```json
{ "status": "ok", "apiVersion": "v1", "uptimeSeconds": 1234 }
```

### Authentication

Optional. The anonymous tier works with no setup — send a key only if you
need a bigger quota.

```bash
curl -H "Authorization: Bearer afb_..." "https://anyfreebook.com/api/v1/search?q=python"
```

| Tier | Requests / minute | Requests / day |
| --- | --- | --- |
| anonymous (no key) | 30 | 200 |
| `free` | 60 | 2,000 |
| `partner` | 300 | 50,000 |

A key that cannot be verified gets `401`. It is never silently downgraded to
the anonymous tier.

### Errors

| Status | Meaning |
| --- | --- |
| `400` | Missing or invalid parameter. |
| `401` | The presented API key could not be verified. |
| `429` | Rate limit exceeded. The `Retry-After` header says how long to wait. |
| `500` | Something broke on our side. |

### CORS

Closed by default. A command-line client or a server-side SDK does not need
CORS at all. Browser clients need their origin added to the server's
allowlist.

---

## Sources

Project Gutenberg · Open Library · Internet Archive · Google Books ·
PubMed Central · DOAJ · LibriVox

Google Books records are catalogue entries, not free copies, and are reported
as `unverified` for exactly that reason.

---

## Contributing

```bash
git clone https://github.com/michaelbanigo575-bot/anyfreebook-cli.git
cd anyfreebook-cli
npm install
npm test
```

The test suite runs entirely against a local mock server — no network access,
no API key needed. The Python SDK has its own suite:

```bash
cd python
python -m pytest tests/ -q
```

Issues and pull requests are welcome: <https://github.com/michaelbanigo575-bot/anyfreebook-cli/issues>

## License

MIT — see [LICENSE](./LICENSE).

---

The API behind this tool is free and needs no key to start:
<https://anyfreebook.com/developers>

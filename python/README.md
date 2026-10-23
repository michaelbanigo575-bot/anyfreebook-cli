# anyfreebook-api

**Python SDK for the ANYFREEBOOK public API** — search seven open-access book
sources and get the legal status of every result, not just a link.

```python
from anyfreebook_api import Client

client = Client()
result = client.search("python", limit=5)

for book in result.results:
    if book.tier == "download":
        print(book.title, "->", book.files[0].url)
```

**No runtime dependencies.** Standard library only, so it installs anywhere.

---

## Install

```bash
pip install anyfreebook-api
```

Or from a clone:

```bash
git clone https://github.com/michaelbanigo575-bot/anyfreebook-cli.git
cd anyfreebook-cli/python
pip install -e .
```

Requires Python 3.9 or newer.

---

## Usage

### Search

```python
from anyfreebook_api import Client

client = Client()

result = client.search("pride and prejudice", limit=5, source="gutenberg")

for book in result.results:
    print(f"{book.tier:10} {book.title} — {book.author}")
    for f in book.files:
        print(f"           {f.format}: {f.url}")
```

`search()` accepts `q`, `page`, `source` and `limit` — the same parameters the
HTTP API takes.

### The tier system

| tier | meaning | can you download it? |
| --- | --- | --- |
| `download` | A verified, public-domain full text. | Yes. |
| `borrow` | A real copy, but borrow-only: a free Internet Archive account and a loan are required. | No. |
| `unverified` | A catalogue record or search page. No confirmed free copy of this exact title. | No. |

The tier comes from the source's own metadata, never a guess.

### Partial results

A short result set is not always a complete one. If a source was down or rate
limited, `partial` is `True` and `failed_sources` names it:

```python
result = client.search("python")
if result.partial:
    print("incomplete: these sources did not answer:", result.failed_sources)
```

### Resolve one title

```python
resolved = client.resolve("Pride and Prejudice", author="Jane Austen")

print(resolved.tier)          # 'download'
print(resolved.tier_reason)   # 'Verified public-domain full text on Project Gutenberg.'
for f in resolved.files:
    print(f.format, f.url)
```

`resolve()` checks the author against the real record, so a book by one author
never resolves to a different book that merely shares a surname.

### Download a file

```python
from anyfreebook_api import Client, download

client = Client()
result = client.search("pride and prejudice", source="gutenberg", limit=1)

for book in result.results:
    if book.tier == "download" and book.files:
        path = download(book.files[0], "./books")
        print("saved", path)
```

`download(file, dest_dir)` writes the bytes to disk and returns the path. It
only ever downloads a file you have already checked — the tier check is yours
to make, and the helper refuses nothing on its own, so keep the `tier` check
in front of it.

### Errors

```python
from anyfreebook_api import ApiError, NetworkError, RateLimitError

try:
    result = client.search("python")
except RateLimitError as exc:
    print("slow down:", exc.retry_after, "seconds")
except ApiError as exc:
    print("API said", exc.status, exc.message)
except NetworkError as exc:
    print("could not reach the API:", exc)
```

`RateLimitError` carries `retry_after` (seconds, parsed from the `Retry-After`
header). `ApiError` carries `status` and `message`. `NetworkError` means the
request never completed.

### Configuration

```python
client = Client(
    base_url="https://anyfreebook.com/api/v1",  # or ANYFREEBOOK_API_BASE
    api_key="afb_...",                          # or ANYFREEBOOK_API_KEY
    timeout=20.0,
)
```

A key is optional. Without one you get the anonymous tier — 30 requests a
minute and 200 a day. A key raises that. A key that cannot be verified raises
`ApiError` with status 401; it is never silently downgraded.

---

## API reference

Base URL: `https://anyfreebook.com/api/v1`

| Endpoint | Parameters |
| --- | --- |
| `GET /search` | `q` (required), `page`, `source`, `limit` |
| `GET /resolve` | `title` (required), `author` |
| `GET /health` | — |

Full reference, including the exact response shape:
<https://anyfreebook.com/developers/api>

---

## Tests

```bash
cd python
python -m pytest tests/ -q
```

The suite uses a stub transport — it never touches the network.

## License

MIT

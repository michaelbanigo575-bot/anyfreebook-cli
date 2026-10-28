/**
 * A tiny stand-in for the ANYFREEBOOK public API (v1).
 *
 * It mirrors the frozen v1 contract closely enough to exercise the CLI
 * offline: search / resolve / health, the three tiers, partial results, a
 * rate-limit response, an unauthorized response, and one downloadable file.
 *
 * Usage:
 *   node test/mock-api.js            # prints the base URL, stays alive
 *
 * Or import it from a test:
 *   const { url } = await startMockApi();
 */

import http from 'node:http';

const NOW = '2026-10-23T23:30:00.000Z';

const CATALOGUE = [
  {
    id: 'pg-1342',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    year: 1813,
    source: 'Project Gutenberg',
    sourceType: 'gutenberg',
    sourceUrl: 'https://www.gutenberg.org/ebooks/1342',
    tier: 'download',
    tierReason: 'Verified public-domain full text on Project Gutenberg.',
    license: 'Public domain',
    files: [
      { format: 'epub', url: '/files/pride-and-prejudice.epub', bytes: null, label: 'EPUB' },
      { format: 'txt', url: '/files/pride-and-prejudice.txt', bytes: null, label: 'Plain text' },
    ],
    url: 'https://anyfreebook.com/book/pride-and-prejudice-pg-1342',
  },
  {
    id: 'pg-84',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    year: 1818,
    source: 'Project Gutenberg',
    sourceType: 'gutenberg',
    sourceUrl: 'https://www.gutenberg.org/ebooks/84',
    tier: 'download',
    tierReason: 'Verified public-domain full text on Project Gutenberg.',
    license: 'Public domain',
    files: [
      { format: 'epub', url: '/files/frankenstein.epub', bytes: null, label: 'EPUB' },
    ],
    url: 'https://anyfreebook.com/book/frankenstein-pg-84',
  },
  {
    id: 'ia-moby-dick',
    title: 'Moby-Dick',
    author: 'Herman Melville',
    year: 1851,
    source: 'Internet Archive',
    sourceType: 'archive',
    sourceUrl: 'https://archive.org/details/mobydick',
    tier: 'borrow',
    tierReason: 'Internet Archive holds a lending-restricted copy; a free account and a loan are required.',
    license: 'Public domain (borrowed, not downloadable)',
    files: [],
    url: 'https://anyfreebook.com/book/moby-dick-ia-moby-dick',
  },
  {
    id: 'ol-clean-code',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    year: 2008,
    source: 'Open Library',
    sourceType: 'openlibrary',
    sourceUrl: 'https://openlibrary.org/works/OL45804W',
    tier: 'unverified',
    tierReason: 'No confirmed free, legal copy of this exact title was found.',
    license: null,
    files: [],
    url: 'https://anyfreebook.com/book/clean-code-ol-clean-code',
  },
  {
    id: 'pmc-nutrition',
    title: 'Nutrition and Metabolic Health',
    author: 'V. Tripathi et al.',
    year: 2021,
    source: 'PubMed Central',
    sourceType: 'pubmed',
    sourceUrl: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8350000/',
    tier: 'download',
    tierReason: 'Open-access article in PubMed Central.',
    license: 'CC BY 4.0',
    files: [
      { format: 'pdf', url: '/files/nutrition.pdf', bytes: 512000, label: 'PDF' },
    ],
    url: 'https://anyfreebook.com/book/nutrition-and-metabolic-health-pmc-nutrition',
  },
];

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

/** Turn the fixture's relative file paths into absolute, downloadable URLs. */
function absoluteFiles(files, port) {
  return (files || []).map((file) => ({
    ...file,
    url: file.url.startsWith('/') ? `http://127.0.0.1:${port}${file.url}` : file.url,
  }));
}

function searchPayload(query, page, limit, port) {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  let results = CATALOGUE.filter((book) =>
    words.some((word) => `${book.title} ${book.author} ${book.source}`.toLowerCase().includes(word)),
  );
  // Keep the fixture list mixed so every tier is exercised.
  if (results.length < 3) {
    for (const book of CATALOGUE) {
      if (!results.includes(book)) results.push(book);
      if (results.length >= 4) break;
    }
  }

  const start = (page - 1) * limit;
  const paged = results.slice(start, start + limit).map((book) => ({
    ...book,
    files: absoluteFiles(book.files, port),
  }));

  return {
    query,
    page,
    limit,
    total: 12345,
    count: paged.length,
    sources: { 'Project Gutenberg': 300, 'Open Library': 5000, 'Internet Archive': 1204 },
    failedSources: [],
    partial: false,
    results: paged,
    meta: { apiVersion: 'v1', generatedAt: NOW },
  };
}

export function startMockApi({ port = 0 } = {}) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/v1/health') {
      json(response, 200, { status: 'ok', apiVersion: 'v1', uptimeSeconds: 1234 });
      return;
    }

    if (pathname === '/api/v1/sources') {
      json(response, 200, {
        apiVersion: 'v1',
        generatedAt: NOW,
        sources: [
          {
            id: 'gutenberg',
            label: 'Project Gutenberg',
            kind: 'books',
            description: 'The largest library of public-domain ebooks.',
            homepage: 'https://www.gutenberg.org',
            tier: 'download',
            providesFiles: true,
            catalogueSize: '79,666 ebooks',
            licence: 'Public domain in the United States',
          },
          {
            id: 'openlibrary',
            label: 'Open Library',
            kind: 'books',
            description: 'The catalogue layer: what exists, and which edition of it is free.',
            homepage: 'https://openlibrary.org',
            tier: 'unverified',
            providesFiles: false,
            licence: 'Varies by edition',
          },
        ],
      });
      return;
    }

    if (pathname === '/api/v1/search') {
      const query = url.searchParams.get('q') || '';
      const lower = query.toLowerCase();

      if (lower.includes('ratelimit')) {
        json(response, 429, { error: 'Too many requests. Slow down.' }, { 'retry-after': '30' });
        return;
      }
      if (lower.includes('unauthorized')) {
        json(response, 401, { error: 'Missing or invalid API key.' });
        return;
      }
      if (lower.includes('boom')) {
        json(response, 500, { error: 'Upstream source exploded.' });
        return;
      }

      const page = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 20);
      const payload = searchPayload(query, page, limit, server.address().port);

      if (lower.includes('partial')) {
        payload.failedSources = ['PubMed Central'];
        payload.partial = true;
        payload.results = payload.results.filter((book) => book.tier === 'download');
      }

      if (lower.includes('borrowonly')) {
        payload.results = payload.results.filter((book) => book.tier !== 'download');
      }

      json(response, 200, payload);
      return;
    }

    if (pathname === '/api/v1/resolve') {
      const title = url.searchParams.get('title') || '';
      const lower = title.toLowerCase();
      if (lower.includes('moby')) {
        const book = CATALOGUE.find((entry) => entry.id === 'ia-moby-dick');
        json(response, 200, {
          title: book.title,
          author: book.author,
          tier: book.tier,
          tierReason: book.tierReason,
          sourceType: book.sourceType,
          sourceUrl: book.sourceUrl,
          license: book.license,
          files: [],
          links: [{ label: `Borrow on ${book.source}`, url: book.sourceUrl, source: book.source }],
          meta: { apiVersion: 'v1', generatedAt: NOW },
        });
        return;
      }
      if (lower.includes('clean code')) {
        const book = CATALOGUE.find((entry) => entry.id === 'ol-clean-code');
        json(response, 200, {
          title: book.title,
          author: book.author,
          tier: book.tier,
          tierReason: book.tierReason,
          sourceType: book.sourceType,
          sourceUrl: book.sourceUrl,
          license: null,
          files: [],
          links: [{ label: `View on ${book.source}`, url: book.sourceUrl, source: book.source }],
          meta: { apiVersion: 'v1', generatedAt: NOW },
        });
        return;
      }
      const book = CATALOGUE[0];
      json(response, 200, {
        title: book.title,
        author: book.author,
        tier: book.tier,
        tierReason: book.tierReason,
        sourceType: book.sourceType,
        sourceUrl: book.sourceUrl,
        license: book.license,
        files: absoluteFiles(book.files, server.address().port),
        links: [{ label: `Read on ${book.source}`, url: book.sourceUrl, source: book.source }],
        meta: { apiVersion: 'v1', generatedAt: NOW },
      });
      return;
    }

    if (pathname.startsWith('/files/')) {
      const body = `Mock public-domain payload for ${pathname.split('/').pop()}\n`;
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }

    json(response, 404, { error: `No mock endpoint for ${pathname}.` });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/api/v1`,
        port: address.port,
        close: () =>
          new Promise((done) => {
            // fetch() keeps sockets alive; without this the server never closes.
            server.close(done);
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          }),
      });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('mock-api.js')) {
  startMockApi({ port: Number(process.env.PORT) || 8787 }).then(({ url }) => {
    process.stdout.write(`mock ANYFREEBOOK API listening on ${url}\n`);
  });
}

## Google Docs Parser Service

Node.js 14-compatible microservice that downloads Google Docs as DOCX, converts them to HTML, and extracts structured data based on user-defined keywords.

### Features

- **Google Docs → DOCX**: Builds the export URL from a standard Google Docs link and downloads the file with `axios`.
- **DOCX → HTML**: Uses `mammoth` to convert the DOCX into raw HTML.
- **HTML parsing**: Uses `cheerio` to walk the DOM.
- **Keyword-based extraction**:
  - Supports inline patterns like `Keyword: Value`.
  - Supports heading/value patterns where the keyword appears as a label and the value is in the next element (e.g. product title/meta description sections).
- **REST API**: Simple Express endpoint for remote use.
- **Temp file management**: Uses a per-request temp directory and cleans it up after processing.

### Tech Stack

- **Runtime**: Node.js 14 (CommonJS, no ES modules)
- **Server**: Express
- **HTTP**: axios
- **DOCX → HTML**: mammoth
- **HTML parsing**: cheerio

### Getting Started

#### 1. Install dependencies

```bash
cd "c:\Projects\Data Extractor"
npm install
```

#### 2. Run the service

```bash
npm start
```

The server listens on `PORT` (default `3000`).

#### 3. Health check

```bash
curl http://localhost:3000/health
```

Response:

```json
{ "status": "ok" }
```

### API

#### POST `/parse-doc`

- **Body**:

```json
{
  "url": "https://docs.google.com/document/d/XXXXXXXXXXXX/edit",
  "keywords": ["Product title", "Meta Description", "Short Product Description", "Long description"]
}
```

- **Response**:

```json
{
  "rawHtml": "<html>...</html>",
  "structuredData": {
    "Product title": "Example title",
    "Meta Description": "Example meta description",
    "Short Product Description": "Item 1 | Item 2 | Item 3",
    "Long description": "Long body content..."
  }
}
```

#### Keyword extraction rules

- **Inline pattern** (same element):
  - Example: `Customer Name: John Doe`
- **Heading + value pattern** (next element):
  - Label element: text exactly equals the keyword (case/whitespace-insensitive), no `:`
  - Value element: next non-empty `p`, `h1`, `h2`, `h3`, `ul`, or `table`
  - `ul` values are joined with ` | `
  - `table` values are flattened by concatenating all cell texts with ` | `

### Error Handling

The service returns structured errors with appropriate HTTP status codes:

- **400**:
  - Invalid request body (missing or non-string `url`, non-array `keywords`)
  - Invalid Google Docs URL (cannot extract document ID)
- **403**:
  - Google Doc not publicly accessible or requires authentication
- **404**:
  - Document not found
- **500**:
  - Unexpected server errors (conversion, parsing, I/O, etc.)

Error responses are of the form:

```json
{ "error": "Human-readable message" }
```

### Code Structure

- `src/server.js`
  - Express app bootstrap
  - `/health` and `/parse-doc` endpoints
  - Maps domain errors to HTTP status codes

- `src/googleDocParser.js`
  - `extractDocId(url)`: Parses the Google Docs ID from the URL.
  - `downloadDoc(url)`: Builds the export URL, downloads DOCX, and writes to a temp path.
  - `convertToHtml(docxPath)`: Converts DOCX to HTML via `mammoth`.
  - `extractStructuredData(html, keywords)`: Parses HTML with `cheerio` and applies the extraction rules above.
  - `processGoogleDoc(url, keywords)`: High-level orchestration; handles temp-file lifecycle and returns `{ rawHtml, structuredData }`.

### Development Notes

- **Node version**: This project targets Node.js 14. Avoid syntax/features that are not supported by Node 14 (e.g. `??=`).
- **Modules**: Use CommonJS (`require`/`module.exports`), not ES modules.
- **Error messages**: Prefer clear, user-facing messages; internal details should be logged separately if/when a logger is added.
- **HTML extraction**:
  - Be conservative when treating an element as a pure label; it must exactly match the keyword text (ignoring case and extra spaces) and contain no `:`.
  - When evolving extraction rules, keep them deterministic and documented here so clients know what to expect.

### Future Enhancements (Ideas)

- Optional authentication support for non-public Google Docs (OAuth/service account).
- Pluggable extraction strategies (e.g. regex-based, template-based, or ML-assisted).
- Batch processing endpoint for multiple documents.
- Structured logging, metrics, and request IDs for observability.


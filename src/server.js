const express = require('express');
const bodyParser = require('body-parser');
const { processGoogleDoc } = require('./googleDocParser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '2mb' }));

/**
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * POST /parse-doc
 *
 * Body:
 * {
 *   "url": "google doc link",
 *   "keywords": ["Customer Name", "Total"]
 * }
 *
 * Response:
 * {
 *   "rawHtml": "<h1>...</h1>",
 *   "structuredData": { ... }
 * }
 */
app.post('/parse-doc', async (req, res) => {
  const { url, keywords } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'Invalid request: "url" is required and must be a string.',
    });
  }

  if (keywords && !Array.isArray(keywords)) {
    return res.status(400).json({
      error: 'Invalid request: "keywords" must be an array of strings if provided.',
    });
  }

  try {
    const result = await processGoogleDoc(url, keywords || []);
    return res.json(result);
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error';

    // Map known error types to HTTP status codes.
    if (
      message.includes('Unauthorized access') ||
      message.includes('not publicly accessible')
    ) {
      return res.status(403).json({ error: message });
    }

    if (message.includes('Document not found')) {
      return res.status(404).json({ error: message });
    }

    if (message.includes('Invalid Google Docs URL')) {
      return res.status(400).json({ error: message });
    }

    // Default to 500 for unexpected errors.
    // In production you may also want to log the full error with a logger.
    return res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});


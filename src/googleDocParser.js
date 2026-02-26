const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const mammoth = require('mammoth');

/**
 * Extract the Google Docs document ID from a standard Docs URL.
 * Example:
 *   https://docs.google.com/document/d/1ABC123XYZ/edit
 *   -> 1ABC123XYZ
 *
 * @param {string} url
 * @returns {string}
 */
function extractDocId(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Invalid URL: URL must be a non-empty string.');
  }

  const match = url.match(/https?:\/\/docs\.google\.com\/document\/d\/([^/]+)/);
  if (!match || !match[1]) {
    throw new Error('Invalid Google Docs URL: Unable to extract document ID.');
  }

  return match[1];
}

/**
 * Build the Google Docs export URL for DOCX.
 *
 * @param {string} docId
 * @returns {string}
 */
function buildExportUrl(docId) {
  return `https://docs.google.com/document/d/${docId}/export?format=docx`;
}

/**
 * Download a DOCX file from Google Docs and save to a temporary path.
 *
 * Handles public and non-public docs by inspecting the HTTP status code
 * and response content-type. Throws a clear error when access is unauthorized.
 *
 * @param {string} docUrl
 * @returns {Promise<string>} Absolute path to the downloaded temp file.
 */
async function downloadDoc(docUrl) {
  const docId = extractDocId(docUrl);
  const exportUrl = buildExportUrl(docId);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdoc-parser-'));
  const tempFilePath = path.join(tempDir, `${docId}.docx`);

  try {
    const response = await axios.get(exportUrl, {
      responseType: 'arraybuffer',
      validateStatus: function (status) {
        // Let us handle non-2xx manually.
        return status >= 200 && status < 400;
      },
    });

    // Detect unauthorized or non-DOCX responses.
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Unauthorized access: The Google Doc is not publicly accessible or requires authentication.'
      );
    }

    const contentType = response.headers && response.headers['content-type'];
    const isDocx =
      contentType &&
      contentType.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

    if (!isDocx) {
      throw new Error(
        'Unexpected response from Google Docs. The document may not be publicly accessible or the URL may be invalid.'
      );
    }

    fs.writeFileSync(tempFilePath, response.data);
    return tempFilePath;
  } catch (err) {
    // Cleanup temp directory on failure.
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      if (fs.existsSync(path.dirname(tempFilePath))) {
        fs.rmdirSync(path.dirname(tempFilePath));
      }
    } catch (_) {
      // Best-effort cleanup.
    }

    if (err.response && err.response.status === 404) {
      throw new Error('Document not found: Please verify the Google Docs URL.');
    }

    if (
      err.message &&
      err.message.toLowerCase().includes('unauthorized access')
    ) {
      throw err;
    }

    throw new Error(
      `Failed to download document from Google Docs: ${err.message}`
    );
  }
}

/**
 * Convert a DOCX file at the given path to raw HTML using mammoth.
 *
 * @param {string} docxPath
 * @returns {Promise<string>} Raw HTML
 */
async function convertToHtml(docxPath) {
  if (!docxPath || typeof docxPath !== 'string') {
    throw new Error('Invalid DOCX path.');
  }

  if (!fs.existsSync(docxPath)) {
    throw new Error('DOCX file does not exist at the given path.');
  }

  try {
    const result = await mammoth.convertToHtml({ path: docxPath });
    return result.value || '';
  } catch (err) {
    throw new Error(`Failed to convert DOCX to HTML: ${err.message}`);
  }
}

/**
 * Extract structured data from HTML based on a list of keywords.
 *
 * Supports two patterns:
 *
 * 1. Inline pattern (same element)
 *    e.g. "Customer Name: John Doe"
 *
 * 2. Heading + value pattern (next element)
 *    e.g.
 *      "<strong>Product title</strong>"
 *      "<p>AMD PS7601BDVIHAF EPYC 7601 ...</p>"
 *
 * In pattern (2) we treat the element that ONLY contains the keyword text
 * as a label, and take the text content of the next non-empty element
 * (p/h1/h2/h3/ul/table) as its value.
 *
 * @param {string} html
 * @param {string[]} keywords
 * @returns {Object}
 */
function extractStructuredData(html, keywords) {
  if (typeof html !== 'string') {
    throw new Error('HTML must be a string.');
  }

  if (!Array.isArray(keywords)) {
    throw new Error('Keywords must be provided as an array of strings.');
  }

  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

  const structuredData = {};

  // Normalize keywords for matching but keep original for keys.
  const normalizedKeywords = keywords
    .filter((k) => typeof k === 'string' && k.trim())
    .map((k) => ({
      original: k,
      normalized: k.toLowerCase().trim(),
    }));

  // Elements we care about for labels and values.
  const selector = 'p, h1, h2, h3, ul, table';

  // Helper to normalize text for comparison (case/whitespace insensitive).
  function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // First pass: handle inline "Keyword: value" pattern.
  $(selector).each((_, elem) => {
    const rawText = $(elem).text().trim();
    if (!rawText) return;

    const lowerText = rawText.toLowerCase();

    normalizedKeywords.forEach((keyword) => {
      if (!lowerText.includes(keyword.normalized)) {
        return;
      }

      const idx = lowerText.indexOf(keyword.normalized);
      if (idx === -1) return;

      const afterKeyword = rawText.slice(idx + keyword.normalized.length);
      const colonIndex = afterKeyword.indexOf(':');

      if (colonIndex === -1) {
        return;
      }

      const value = afterKeyword.slice(colonIndex + 1).trim();
      if (value) {
        structuredData[keyword.original] = value;
      }
    });
  });

  // Second pass: heading + value pattern.
  let pendingLabel = null; // { original, normalized }

  $(selector).each((_, elem) => {
    const $elem = $(elem);
    const rawText = $elem.text().trim();
    if (!rawText) {
      return;
    }

    const normalizedElemText = normalizeText(rawText);

    // If we currently have a pending label, try to capture its value
    // from this element.
    if (pendingLabel) {
      // Skip if this line just repeats the label.
      if (normalizedElemText === pendingLabel.normalized) {
        return;
      }

      // Construct value depending on element type.
      let valueText = '';
      const tag = $elem.get(0).tagName.toLowerCase();

      if (tag === 'ul') {
        const items = [];
        $elem.find('li').each((__, li) => {
          const liText = $(li).text().trim();
          if (liText) items.push(liText);
        });
        valueText = items.join(' | ');
      } else if (tag === 'table') {
        // Flatten table text, preserving some structure.
        const cells = [];
        $elem.find('th, td').each((__, cell) => {
          const cellText = $(cell).text().trim();
          if (cellText) cells.push(cellText);
        });
        valueText = cells.join(' | ');
      } else {
        valueText = rawText;
      }

      if (valueText) {
        structuredData[pendingLabel.original] = valueText;
        pendingLabel = null;
      }

      return;
    }

    // If we don't have a pending label, check if this element
    // is itself a pure label (just the keyword text, no colon / extra).
    normalizedKeywords.forEach((keyword) => {
      if (pendingLabel) {
        return;
      }

      // Must match the keyword exactly (ignoring case/whitespace)
      // and not contain a colon (to avoid "Keyword: value" which is
      // already handled in the first pass).
      if (
        normalizedElemText === keyword.normalized &&
        !rawText.includes(':')
      ) {
        pendingLabel = keyword;
      }
    });
  });

  return structuredData;
}

/**
 * High-level function to process a Google Doc URL and return raw HTML
 * and structured data for the given keywords.
 *
 * This function is responsible for cleaning up the temporary DOCX file.
 *
 * @param {string} url
 * @param {string[]} keywords
 * @returns {Promise<{ rawHtml: string, structuredData: Object }>}
 */
async function processGoogleDoc(url, keywords) {
  let tempFilePath;
  let tempDir;

  try {
    tempFilePath = await downloadDoc(url);
    tempDir = path.dirname(tempFilePath);

    const rawHtml = await convertToHtml(tempFilePath);
    const structuredData = extractStructuredData(rawHtml, keywords || []);

    return {
      rawHtml,
      structuredData,
    };
  } finally {
    // Best-effort cleanup of temp file and directory.
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {
        // Ignore cleanup errors.
      }
    }

    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmdirSync(tempDir);
      } catch (_) {
        // Ignore cleanup errors.
      }
    }
  }
}

module.exports = {
  extractDocId,
  downloadDoc,
  convertToHtml,
  extractStructuredData,
  processGoogleDoc,
};


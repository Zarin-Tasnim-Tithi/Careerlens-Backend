// Server-side resume text extraction (replaces the browser-loaded PDF.js / Mammoth CDN modules).
// Files are never executed; we only verify signatures and read text with maintained parsers.
const mammoth = require('mammoth');

const MAX_PAGES = 20;
let pdfjsPromise;
const loadPdfjs = () => (pdfjsPromise ||= import('pdfjs-dist/legacy/build/pdf.mjs'));

/** Extracts text with Mozilla PDF.js (eval disabled, no fonts/canvas needed, first 20 pages). */
async function pdfToText(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
  }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i += 1) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
    }
    return pages.join('\n');
  } finally {
    await doc.destroy();
  }
}
const ApiError = require('../utils/ApiError');

const MAX_TEXT = 50000; // cap extracted characters stored per resume

function detectType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    // DOCX is a ZIP that must contain word/document.xml
    if (buffer.includes(Buffer.from('word/document.xml'))) return 'docx';
  }
  return null;
}

const tidy = (text) => text
  .replace(/\r/g, '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

async function extractText(buffer, originalName) {
  const ext = (originalName.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const detected = detectType(buffer);
  if (!detected || `.${detected}` !== ext) {
    throw new ApiError(415, 'INVALID_FILE_SIGNATURE', 'The file content is not a valid PDF or DOCX document');
  }
  let text = '';
  try {
    if (detected === 'pdf') {
      text = await pdfToText(buffer);
    } else {
      text = (await mammoth.extractRawText({ buffer })).value;
    }
  } catch {
    throw new ApiError(422, 'UNREADABLE_FILE', detected === 'pdf'
      ? 'This PDF cannot be read. Check for encryption or damage.'
      : 'This Word file cannot be read.');
  }
  text = tidy(text || '');
  if (text.length < 50) {
    throw new ApiError(422, 'NO_TEXT_FOUND', 'Not enough selectable text found. Scanned or image-only files need OCR, which is not supported.');
  }
  return { type: detected, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
}

module.exports = { extractText, detectType, MAX_TEXT };

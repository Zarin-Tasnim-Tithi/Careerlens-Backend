// Builds downloadable CV files from plain-text drafts.
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const PDFDocument = require('pdfkit');

const looksLikeHeading = (line) => line.length <= 40 && /^[A-Z][A-Z &/-]{2,}$/.test(line.trim());

async function toDocx(text, { title = '' } = {}) {
  const children = [];
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  for (const line of text.split('\n')) {
    children.push(looksLikeHeading(line)
      ? new Paragraph({ text: line.trim(), heading: HeadingLevel.HEADING_2 })
      : new Paragraph({ children: [new TextRun(line)] }));
  }
  const doc = new Document({ creator: 'CareerLens', title: title || 'Curriculum Vitae', sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function toPdf(text, { title = '' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title || 'Curriculum Vitae', Creator: 'CareerLens' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    if (title) doc.font('Helvetica-Bold').fontSize(16).fillColor('#182d23').text(title).moveDown(0.6);
    for (const line of text.split('\n')) {
      // Built-in PDF fonts only cover Latin-1; replace anything else so export never fails.
      const safe = line.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF•–—’‘“”]/g, '?').replace(/[•]/g, '-').replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
      if (looksLikeHeading(line)) doc.moveDown(0.3).font('Helvetica-Bold').fontSize(12).fillColor('#26744d').text(safe.trim());
      else doc.font('Helvetica').fontSize(10.5).fillColor('#182d23').text(safe || ' ', { lineGap: 2 });
    }
    doc.end();
  });
}

module.exports = { toDocx, toPdf };

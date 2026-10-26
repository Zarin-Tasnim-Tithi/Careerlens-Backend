const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/respond');
const { Resume, ResumeAnalysis, Application } = require('../models');
const { extractText } = require('../services/resumeText');
const { analyzeResume, improveResume } = require('../services/resumeAnalyzer');
const { saveFile, deleteFile } = require('../services/storage');
const { toDocx, toPdf } = require('../services/exporter');
const { logActivity } = require('../services/events');
const { assertObjectId } = require('../utils/helpers');

const MAX_RESUMES = 10;
const safeName = (name) => name.replace(/[^\w.\- ()]+/g, '_').slice(0, 150);

const resumeOut = (r, extra = {}) => ({
  id: String(r._id), filename: r.filename, mimeType: r.mimeType, size: r.size, textLength: r.textLength, wordCount: r.wordCount,
  latestScore: r.latestScore ?? null, latestAnalysisId: r.latestAnalysisId ? String(r.latestAnalysisId) : null,
  draft: r.draft ? { ...((r.draft.toObject && r.draft.toObject()) || r.draft) } : null,
  createdAt: r.createdAt, updatedAt: r.updatedAt, ...extra,
});

const analysisOut = (a) => {
  const o = a.toJSON ? a.toJSON() : { ...a, id: String(a._id) };
  delete o._id;
  return { ...o, resumeId: String(o.resumeId), studentId: String(o.studentId) };
};

// POST /resumes/upload (multipart field "file") — validated PDF/DOCX, text extracted on the server, file stored privately.
exports.upload = async (req, res) => {
  if (!req.file) throw ApiError.validation('Please attach a PDF or DOCX file in the "file" field');
  if (await Resume.countDocuments({ studentId: req.user._id }) >= MAX_RESUMES) {
    throw ApiError.conflict(`You can keep up to ${MAX_RESUMES} resumes. Delete an old one first.`, 'RESUME_LIMIT');
  }
  const filename = safeName(req.file.originalname);
  const { text, truncated } = await extractText(req.file.buffer, filename);
  const storageKey = await saveFile(req.file.buffer, { filename, contentType: req.file.mimetype, ownerId: req.user._id });
  const resume = await Resume.create({
    studentId: req.user._id, filename, mimeType: req.file.mimetype, size: req.file.size, storageKey,
    parsedText: text, textLength: text.length, wordCount: text.split(/\s+/).filter(Boolean).length,
  });
  await logActivity(req.user, 'resume.uploaded', { targetType: 'Resume', targetId: resume._id, summary: filename });
  return created(res, { resume: resumeOut(resume, { text, truncated }) }, 'Document successfully read. Run the analysis to view your report.');
};

exports.list = async (req, res) => {
  const items = await Resume.find({ studentId: req.user._id }).sort({ createdAt: -1 }).lean();
  return ok(res, { items: items.map((r) => resumeOut(r)) });
};

async function ownResume(req, withText = false) {
  assertObjectId(req.params.id, 'Resume');
  const query = Resume.findById(req.params.id);
  if (withText) query.select('+parsedText');
  const resume = await query;
  if (!resume) throw ApiError.notFound('Resume not found');
  if (String(resume.studentId) !== String(req.user._id)) throw ApiError.forbidden('You can only access your own resumes');
  return resume;
}

// GET /resumes/:id — metadata; ?includeText=true also returns the extracted text (owner only).
exports.getOne = async (req, res) => {
  const includeText = req.query.includeText === 'true';
  const resume = await ownResume(req, includeText);
  return ok(res, { resume: resumeOut(resume, includeText ? { text: resume.parsedText } : {}) });
};

exports.remove = async (req, res) => {
  const resume = await ownResume(req);
  await deleteFile(resume.storageKey);
  await Promise.all([
    ResumeAnalysis.deleteMany({ resumeId: resume._id }),
    Application.updateMany({ resumeId: resume._id }, { $unset: { resumeId: 1 } }),
    resume.deleteOne(),
  ]);
  await logActivity(req.user, 'resume.deleted', { targetType: 'Resume', targetId: resume._id, summary: resume.filename });
  return res.status(204).end();
};

const nextVersion = async (resumeId) => (await ResumeAnalysis.countDocuments({ resumeId })) + 1;

exports.analyze = async (req, res) => {
  const resume = await ownResume(req, true);
  const { targetRole = '', jobDescription = '' } = req.body;
  const text = resume.draft?.sourceText || resume.parsedText;
  const result = analyzeResume(text, targetRole, jobDescription);
  const analysis = await ResumeAnalysis.create({
    resumeId: resume._id, studentId: req.user._id, version: await nextVersion(resume._id), analysisType: 'quality',
    method: result.method, targetRole, jobDescription, score: result.score, rating: result.rating, words: result.words, lines: result.lines,
    sections: result.sections, checks: result.checks, strengths: result.strengths, suggestions: result.suggestions,
    keywordMatch: result.keywordMatch, keywords: result.keywords, missingKeywords: result.missingKeywords,
  });
  resume.latestAnalysisId = analysis._id;
  resume.latestScore = result.score;
  await resume.save();
  await logActivity(req.user, 'resume.analyzed', { targetType: 'Resume', targetId: resume._id, summary: `${resume.filename}: ${result.score}/100` });
  return created(res, { analysis: analysisOut(analysis) }, 'Analysis complete');
};

// GET /resumes/:id/analysis — latest quality analysis; ?history=true returns all versions.
exports.getAnalysis = async (req, res) => {
  const resume = await ownResume(req);
  if (req.query.history === 'true') {
    const items = await ResumeAnalysis.find({ resumeId: resume._id }).select('-improvedText').sort({ version: -1 }).lean();
    return ok(res, { items: items.map(analysisOut) });
  }
  const analysis = await ResumeAnalysis.findOne({ resumeId: resume._id, analysisType: 'quality' }).sort({ version: -1 });
  if (!analysis) throw ApiError.notFound('This resume has not been analysed yet');
  return ok(res, { analysis: analysisOut(analysis) });
};

exports.improve = async (req, res) => {
  const resume = await ownResume(req, true);
  const { targetRole = '', level = '', industry = '', sourceText } = req.body;
  const source = sourceText && sourceText.trim().length >= 50 ? sourceText : (resume.draft?.sourceText || resume.parsedText);
  const result = improveResume(source);
  const analysis = await ResumeAnalysis.create({
    resumeId: resume._id, studentId: req.user._id, version: await nextVersion(resume._id), analysisType: 'improvement',
    method: result.method, targetRole, improvedText: result.improvedText, changes: result.changes,
    suggestions: result.unchanged ? ['No safe automatic wording substitutions were found. Edit the draft for more specific improvements.'] : [],
  });
  resume.draft = { ...((resume.draft && resume.draft.toObject && resume.draft.toObject()) || {}), content: result.improvedText, role: targetRole, level, industry, sourceText: sourceText ? source : (resume.draft?.sourceText || ''), updatedAt: new Date() };
  await resume.save();
  await logActivity(req.user, 'resume.improved', { targetType: 'Resume', targetId: resume._id, summary: `${result.changes.length} wording change(s)` });
  return created(res, {
    improvement: { id: String(analysis._id), version: analysis.version, method: result.method, improvedText: result.improvedText, changes: result.changes, unchanged: result.unchanged },
  }, result.unchanged
    ? 'Review ready. No safe automatic wording substitutions were found. Edit the draft for more specific improvements.'
    : 'Conservative wording edits applied. Review all changes before exporting.');
};

exports.saveDraft = async (req, res) => {
  const resume = await ownResume(req);
  const current = (resume.draft && resume.draft.toObject && resume.draft.toObject()) || {};
  resume.draft = { ...current, ...req.body, updatedAt: new Date() };
  await resume.save();
  return ok(res, { draft: resume.draft }, { message: 'CV draft saved.' });
};

// GET /resumes/:id/export?format=docx|pdf&source=draft|original
exports.exportFile = async (req, res) => {
  const resume = await ownResume(req, true);
  const { format, source } = req.valid.query;
  const text = source === 'original' ? (resume.draft?.sourceText || resume.parsedText) : (resume.draft?.content || '');
  if (!text.trim()) throw ApiError.validation('Create or save a draft before exporting.');
  const base = 'CareerLens-Improved-CV';
  const buffer = format === 'pdf' ? await toPdf(text) : await toDocx(text);
  res.set({
    'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="${base}.${format}"`,
    'Cache-Control': 'private, no-store',
  });
  return res.send(buffer);
};

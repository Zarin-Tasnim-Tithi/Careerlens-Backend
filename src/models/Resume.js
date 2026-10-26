const mongoose = require('mongoose');
const toJSON = require('./plugins');

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Resume metadata. The binary file lives in a private GridFS bucket ("resumes"), never inside user documents.
const resumeSchema = new mongoose.Schema({
  studentId: { type: ObjectId, ref: 'User', required: true, index: true },
  filename: { type: String, required: true, maxlength: 160 },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  storageKey: { type: ObjectId, required: true }, // GridFS file id
  parsedText: { type: String, select: false, maxlength: 60000 }, // capped extracted text
  textLength: { type: Number, default: 0 },
  wordCount: { type: Number, default: 0 },
  latestAnalysisId: { type: ObjectId, ref: 'ResumeAnalysis' },
  latestScore: { type: Number },
  draft: {
    content: { type: String, maxlength: 60000, default: '' },
    sourceText: { type: String, maxlength: 60000, default: '' }, // student-edited original text, if changed
    role: { type: String, maxlength: 80, default: '' },
    industry: { type: String, maxlength: 80, default: '' },
    level: { type: String, maxlength: 40, default: '' },
    language: { type: String, maxlength: 40, default: 'English' },
    jobDescription: { type: String, maxlength: 8000, default: '' },
    template: { type: String, maxlength: 40, default: 'Modern Professional' },
    updatedAt: { type: Date },
  },
}, { timestamps: true });
resumeSchema.plugin(toJSON);

// Each analysis or improvement run is stored as a new version.
const resumeAnalysisSchema = new mongoose.Schema({
  resumeId: { type: ObjectId, ref: 'Resume', required: true, index: true },
  studentId: { type: ObjectId, ref: 'User', required: true, index: true },
  version: { type: Number, required: true },
  analysisType: { type: String, enum: ['quality', 'improvement'], required: true },
  method: { type: String, default: 'rule-based-v1' },
  targetRole: { type: String, default: '' },
  jobDescription: { type: String, maxlength: 8000, default: '' },
  score: { type: Number },
  rating: { type: String },
  words: { type: Number },
  lines: { type: Number },
  sections: { type: [String], default: [] },
  checks: { type: Mixed, default: [] }, // [{ label, passed, advice }]
  strengths: { type: [String], default: [] },
  suggestions: { type: [String], default: [] },
  keywordMatch: { type: Number, default: null },
  keywords: { type: [String], default: [] },
  missingKeywords: { type: [String], default: [] },
  improvedText: { type: String, maxlength: 60000 },
  changes: { type: Mixed, default: [] }, // [{ from, to, count }]
}, { timestamps: true });
resumeAnalysisSchema.plugin(toJSON);

module.exports = {
  Resume: mongoose.model('Resume', resumeSchema, 'resumes'),
  ResumeAnalysis: mongoose.model('ResumeAnalysis', resumeAnalysisSchema, 'resumeAnalyses'),
};

const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream', 'application/zip'],
};

// Files are held in memory only long enough to validate signatures, extract text and stream to GridFS.
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!ALLOWED[ext]) return cb(new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF and DOCX files are supported'));
    if (!ALLOWED[ext].includes(file.mimetype)) return cb(new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'File type does not match its extension'));
    cb(null, true);
  },
}).single('file');

module.exports = { resumeUpload };

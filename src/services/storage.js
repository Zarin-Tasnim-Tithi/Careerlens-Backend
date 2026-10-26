// Private resume file storage in MongoDB GridFS (bucket "resumes").
// Works on Render's free tier, whose local disk is wiped on every restart/deploy.
const mongoose = require('mongoose');
const { Readable } = require('stream');

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'resumes' });

function saveFile(buffer, { filename, contentType, ownerId }) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata: { ownerId: String(ownerId), contentType } });
    Readable.from(buffer).pipe(upload).on('error', reject).on('finish', () => resolve(upload.id));
  });
}

async function readFile(id) {
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(new mongoose.Types.ObjectId(String(id)))) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function deleteFile(id) {
  try { await bucket().delete(new mongoose.Types.ObjectId(String(id))); } catch (err) {
    if (!/FileNotFound|not found/i.test(err.message)) throw err;
  }
}

module.exports = { saveFile, readFile, deleteFile };

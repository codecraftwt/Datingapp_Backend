const multer = require('multer');
const path = require('path');
const fs = require('fs');

const os = require('os');

let uploadDir = path.join(__dirname, '../../uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (mkdirErr) {
  console.warn('Uploads directory not writable, using temp dir:', mkdirErr.message);
  uploadDir = os.tmpdir();
}

// Generate dummy assets if they don't exist
try {
  const sampleDocPath = path.join(uploadDir, 'sample_document.pdf');
  if (!fs.existsSync(sampleDocPath)) {
    fs.writeFileSync(sampleDocPath, '%PDF-1.4\n%dummy pdf content\nFlameMatch Dating App - Simulated PDF Document');
  }
} catch (err) {
  console.warn('Could not write dummy sample_document.pdf:', err.message);
}

try {
  const sampleVoicePath = path.join(uploadDir, 'sample_voice.mp3');
  if (!fs.existsSync(sampleVoicePath)) {
    fs.writeFileSync(sampleVoicePath, 'dummy audio content - FlameMatch Dating App - Simulated MP3 Voice Note');
  }
} catch (err) {
  console.warn('Could not write dummy sample_voice.mp3:', err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || (file.mimetype?.startsWith('video/') ? '.mp4' : '.jpg');
    const uniqueName = `upload_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max limit for video previews
});

module.exports = upload;

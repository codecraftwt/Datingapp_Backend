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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});


const upload = multer({ storage: storage });

module.exports = upload;

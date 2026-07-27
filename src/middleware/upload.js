const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Generate dummy assets if they don't exist
const sampleDocPath = path.join(uploadDir, 'sample_document.pdf');
if (!fs.existsSync(sampleDocPath)) {
  fs.writeFileSync(sampleDocPath, '%PDF-1.4\n%dummy pdf content\nFlameMatch Dating App - Simulated PDF Document');
}
const sampleVoicePath = path.join(uploadDir, 'sample_voice.mp3');
if (!fs.existsSync(sampleVoicePath)) {
  fs.writeFileSync(sampleVoicePath, 'dummy audio content - FlameMatch Dating App - Simulated MP3 Voice Note');
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

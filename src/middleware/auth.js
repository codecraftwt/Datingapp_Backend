const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRETS = [
  process.env.JWT_SECRET,
  'super_secret_dating_app_token_key_123!',
  'fallback_secret',
].filter(Boolean);

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token, authorization denied.' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({ message: 'No valid token provided, authorization denied.' });
    }
    let decoded = null;

    for (const secret of JWT_SECRETS) {
      try {
        decoded = jwt.verify(token, secret);
        if (decoded) break;
      } catch (err) {
        // try next secret
      }
    }

    if (!decoded) {
      return res.status(401).json({ message: 'Token is invalid or expired, authorization denied.' });
    }

    const userId = decoded.userId || decoded.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found, authorization denied.' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error.message);
    res.status(401).json({ message: 'Token is invalid or expired, authorization denied.', error: error.message });
  }
};

module.exports = auth;

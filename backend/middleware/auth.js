const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { getDb } = require('../config/database');

/**
 * Verify JWT token and attach user to request.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : null;
  const token = bearerToken || queryToken;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, email, role, is_active, must_change_password FROM users WHERE id = ?'
    ).get(decoded.userId);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    const isAuthMe = req.baseUrl === '/api/auth' && req.path === '/me';
    const isAuthPasswordChange = req.baseUrl === '/api/auth' && req.path === '/change-password';

    if (user.must_change_password && !isAuthMe && !isAuthPasswordChange) {
      return res.status(403).json({
        error: 'Password reset required before accessing this resource',
        passwordResetRequired: true,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require one of the given roles.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };

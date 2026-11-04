const jwt = require('jsonwebtoken');
const db = require('./db');

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '')
      .replace(/^Bearer\s+/i, '');

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const [rows] = await db.execute(
      `SELECT id, email, role, admin_tier, status, email_verified_at
       FROM users
       WHERE id = ?`,
      [payload.sub]
    );

    if (!rows.length || rows[0].status !== 'active') {
      return res.status(401).json({
        error: 'Account unavailable'
      });
    }

    req.user = rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' ||
        error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Invalid or expired session'
      });
    }

    next(error);
  }
}

async function requireVerification(req, res, next) {
  try {
    // Administrators use a separate access-control policy.
    if (req.user.role === 'admin') {
      return next();
    }

    if (!req.user.email_verified_at) {
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Please verify your email address first.'
      });
    }

    if (req.user.role === 'worker') {
      const [rows] = await db.execute(
        `SELECT identity_verification_status,
                right_to_work_status
         FROM worker_profiles
         WHERE user_id = ?`,
        [req.user.id]
      );

      if (
        !rows.length ||
        rows[0].identity_verification_status !== 'verified' ||
        rows[0].right_to_work_status !== 'verified'
      ) {
        return res.status(403).json({
          code: 'VERIFICATION_REQUIRED',
          error: 'Complete your identity and right-to-work verification before using this feature.'
        });
      }
    } else if (req.user.role === 'employer') {
      const [rows] = await db.execute(
        `SELECT identity_verification_status, verification_status
         FROM businesses
         WHERE owner_user_id = ?`,
        [req.user.id]
      );

      if (
        !rows.length ||
        rows[0].identity_verification_status !== 'verified' ||
        rows[0].verification_status !== 'verified'
      ) {
        return res.status(403).json({
          code: 'VERIFICATION_REQUIRED',
          error: 'Complete your identity and company verification before using this feature.'
        });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

function allow(...roles) {
  return (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : res.status(403).json({
          error: 'Insufficient permissions'
        });
}

function adminTier(maxTier) {
  return (req, res, next) => {
    if (
      req.user?.role !== 'admin' ||
      !req.user.admin_tier ||
      req.user.admin_tier > maxTier
    ) {
      return res.status(403).json({
        error: 'Insufficient administrator permissions'
      });
    }

    next();
  };
}

module.exports = {
  auth,
  allow,
  adminTier,
  requireVerification
};

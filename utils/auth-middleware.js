/**
 * Authentication middleware
 */

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.warn('\n----- AUTH ERROR: Missing authorization header -----');
    return res.status(401).json({ error: 'Authorization header required' });
  }
  
  // Store auth token for use in route handlers
  req.authToken = authHeader;
  
  // Include default country parameter in request
  req.country = req.query.country || 'it';
  
  next();
}

module.exports = { requireAuth };
const express = require('express');
const router = express.Router();

function getIssuedToken() {
  return process.env.AUTH_TOKEN || 'alice-oauth-token-valid';
}

function handleAuthorize(req, res) {
  const redirectUri = req.query.redirect_uri;
  const state = req.query.state;

  if (!redirectUri) {
    return res.status(400).json({ error: 'invalid_request', message: 'Missing redirect_uri' });
  }

  const code = 'test-code';
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return res.redirect(redirectUrl.toString());
}

// Simple token endpoint - returns a test token for use in Authorization header
router.get('/auth', handleAuthorize);
router.get('/endpoint/auth', handleAuthorize);

router.post('/token', (req, res) => {
  // In a real implementation this would validate client credentials
  const token = getIssuedToken();
  res.json({
    access_token: token,
    token_type: 'bearer',
    expires_in: 31536000,
    refresh_token: token,
  });
});

router.post('/endpoint/token', (req, res) => {
  const token = getIssuedToken();
  res.json({
    access_token: token,
    token_type: 'bearer',
    expires_in: 31536000,
    refresh_token: token,
  });
});

module.exports = router;

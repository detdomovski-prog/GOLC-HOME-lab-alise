const express = require('express');
const router = express.Router();

// Simple token endpoint - returns a test token for use in Authorization header
router.post('/token', (req, res) => {
  // In a real implementation this would validate client credentials
  const token = process.env.AUTH_TOKEN || 'test-token';
  res.json({ access_token: token, token_type: 'bearer', expires_in: 3600 });
});

module.exports = router;

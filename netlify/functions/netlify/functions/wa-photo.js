const fetch = require('node-fetch');

exports.handler = async (event) => {
  const photoPath = event.queryStringParameters?.path;
  if (!photoPath) return { statusCode: 400, body: 'Missing path' };

  // Get WA token
  const tokenRes = await fetch('https://oauth.wildapricot.org/auth/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from('APIKEY:' + process.env.WA_API_KEY).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=auto'
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  if (!token) return { statusCode: 502, body: 'Failed to get WA token' };

  // Fetch the image
  const imgRes = await fetch(photoPath, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!imgRes.ok) return { statusCode: imgRes.status, body: 'Image fetch failed' };

  const buffer = await imgRes.buffer();
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600'
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
};

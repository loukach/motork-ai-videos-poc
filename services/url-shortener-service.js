/**
 * URL Shortener Service
 * Handles URL shortening through is.gd API
 */

const axios = require('axios');

/**
 * Shortens a URL using the is.gd service
 * 
 * @param {string} originalUrl - The URL to shorten
 * @param {Object} options - Additional options
 * @param {string} options.logPrefix - Prefix for log messages (e.g., task ID)
 * @returns {Promise<string>} - The shortened URL or original URL if shortening fails
 */
async function shortenUrl(originalUrl, { logPrefix = '' } = {}) {
  const logTag = logPrefix ? `[${logPrefix}]` : '';
  console.log(`${logTag} 🔗 Shortening URL...`);
  
  try {
    // URL encode the original URL
    const encodedUrl = encodeURIComponent(originalUrl);
    console.log(`${logTag} Calling is.gd API...`);
    const shortenStartTime = new Date();
    
    const shortenResponse = await axios({
      method: 'get',
      url: `https://is.gd/create.php?format=json&url=${encodedUrl}`
    });
    
    const shortenTime = Math.round((new Date() - shortenStartTime));
    
    if (shortenResponse.data && shortenResponse.data.shorturl) {
      const shortUrl = shortenResponse.data.shorturl;
      console.log(`${logTag} ✅ URL shortened successfully in ${shortenTime}ms: ${shortUrl}`);
      console.log(`${logTag} Original: ${originalUrl.substring(0, 30)}... → Shortened: ${shortUrl}`);
      return shortUrl;
    } else {
      console.log(`${logTag} ⚠️ URL shortener returned unexpected response (${shortenTime}ms), using original URL`);
      console.log(`${logTag} Response:`, JSON.stringify(shortenResponse.data));
      return originalUrl;
    }
  } catch (shortenError) {
    console.log(`${logTag} ❌ URL shortening failed, using original URL: ${shortenError.message}`);
    if (shortenError.response) {
      console.log(`${logTag} Response status: ${shortenError.response.status}`);
    }
    // Continue with the original URL if shortening fails
    return originalUrl;
  }
}

module.exports = {
  shortenUrl
};
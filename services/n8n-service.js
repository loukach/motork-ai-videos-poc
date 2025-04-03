/**
 * N8N Service - Handles communication with the n8n webhooks
 */

const axios = require('axios');
const config = require('../utils/config');
const logger = require('../utils/logger');

/**
 * Forward a message to n8n webhook
 * @param {Object} params - Parameters for the n8n request
 * @param {string} params.sessionId - Unique session identifier
 * @param {string} params.message - User message to process
 * @param {string} [params.page] - Page where user is interacting (optional)
 * @param {string} [params.authToken] - Authorization token to forward to n8n
 * @param {string} [params.logPrefix] - Prefix for logging (default: 'N8N')
 * @returns {Promise<Object>} - n8n response
 */
async function forwardToN8n({ sessionId, message, page, authToken, logPrefix = 'N8N' }) {
  const isProduction = process.env.NODE_ENV === 'production';
  const targetUrl = isProduction 
    ? config.n8n.prodWebhookUrl
    : config.n8n.testWebhookUrl;
  
  logger.info(logPrefix, `Forwarding request to ${targetUrl}`, {
    sessionId: sessionId,
    page: page || 'N/A',
    hasAuth: authToken ? 'Yes' : 'No'
  });
  
  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Add authorization header if provided
    if (authToken) {
      headers['Authorization'] = authToken;
    }
    
    const response = await axios({
      method: 'post',
      url: targetUrl,
      headers: headers,
      data: {
        sessionId,
        message,
        page: page || undefined
      }
    });
    
    // Log the response from n8n, with special handling for JSON responses
    logger.info(logPrefix, 'Received response from n8n', {
      sessionId: sessionId
    });
    
    // If the response is JSON, log it more clearly in the console
    if (response.data) {
      if (typeof response.data === 'object') {
        console.log(`\n----- N8N JSON RESPONSE [${sessionId}] -----`);
        console.log(JSON.stringify(response.data, null, 2));
      } else if (typeof response.data === 'string' && (response.data.startsWith('{') || response.data.startsWith('['))) {
        // Try to parse string as JSON
        try {
          const jsonData = JSON.parse(response.data);
          console.log(`\n----- N8N JSON RESPONSE [${sessionId}] -----`);
          console.log(JSON.stringify(jsonData, null, 2));
        } catch (e) {
          // Not valid JSON, log as is
          console.log(`\n----- N8N RESPONSE [${sessionId}] -----`);
          console.log(response.data);
        }
      } else {
        console.log(`\n----- N8N RESPONSE [${sessionId}] -----`);
        console.log(response.data);
      }
    }
    
    // Return the response data as-is to preserve the exact format from n8n
    return response.data;
  } catch (error) {
    // Log detailed error information
    logger.error(logPrefix, `Error communicating with n8n: ${error.message}`, {
      sessionId: sessionId,
      errorCode: error.response?.status || 'network_error'
    });
    
    if (error.response) {
      logger.error(logPrefix, 'n8n response error', {
        status: error.response.status,
        data: JSON.stringify(error.response.data).substring(0, 200) // Avoid huge logs
      });
    }
    
    // Re-throw the error to be handled by the caller
    throw error;
  }
}

module.exports = {
  forwardToN8n
};
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
 * @param {string} [params.lastResponse] - Previous response from n8n (optional)
 * @param {string} [params.authToken] - Authorization token to forward to n8n
 * @param {string} [params.logPrefix] - Prefix for logging (default: 'N8N')
 * @returns {Promise<Object>} - n8n response
 */
async function forwardToN8n({ sessionId, message, page, lastResponse, authToken, logPrefix = 'N8N' }) {
  const isProduction = process.env.NODE_ENV === 'production';
  const targetUrl = isProduction 
    ? config.n8n.prodWebhookUrl
    : config.n8n.testWebhookUrl;
  
  // Use specialized n8n logger instead of generic info
  logger.n8n('Request', `Forwarding to ${isProduction ? 'production' : 'test'} webhook`, {
    sessionId,
    page: page || 'N/A',
    messageLength: message?.length || 0,
    hasLastResponse: lastResponse ? 'Yes' : 'No',
    hasAuth: authToken ? 'Yes' : 'No',
    targetUrl: targetUrl.split('/').slice(0, 3).join('/') + '/...' // Log just the domain, not the full URL
  }, sessionId);
  
  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Add authorization header if provided
    if (authToken) {
      headers['Authorization'] = authToken;
    }
    
    const startTime = new Date();
    const response = await axios({
      method: 'post',
      url: targetUrl,
      headers: headers,
      data: {
        sessionId,
        message,
        page: page || undefined,
        lastResponse: lastResponse || undefined
      }
    });
    const requestTime = new Date() - startTime;
    
    // Log the response from n8n with timing information
    logger.n8n('Response', `Received response in ${requestTime}ms`, {
      sessionId,
      responseType: typeof response.data,
      responseSize: JSON.stringify(response.data).length
    }, sessionId);
    
    // Process and log the response data more clearly
    if (response.data) {
      // Create a consistent format for both object and string responses
      let formattedData;
      
      if (typeof response.data === 'object') {
        // Already a JSON object
        formattedData = response.data;
      } else if (typeof response.data === 'string' && 
                (response.data.startsWith('{') || response.data.startsWith('['))) {
        // Try to parse string as JSON
        try {
          formattedData = JSON.parse(response.data);
        } catch (e) {
          // Not valid JSON despite appearances
          formattedData = { rawResponse: response.data.substring(0, 100) + (response.data.length > 100 ? '...' : '') };
        }
      } else {
        // Text response or other format
        formattedData = { 
          rawResponse: response.data.substring(0, 100) + (response.data.length > 100 ? '...' : '')
        };
      }
      
      // Log the actual response data content with our specialized logger
      logger.n8n('Data', 'Response data', formattedData, sessionId);
    }
    
    // Return the response data as-is to preserve the exact format from n8n
    return response.data;
  } catch (error) {
    // Use specialized error logging
    logger.error('N8N', `Communication error: ${error.message}`, {
      sessionId,
      errorCode: error.response?.status || 'network_error',
      errorType: error.code || 'unknown',
      target: targetUrl.split('/').slice(0, 3).join('/') + '/...' // Just log the domain for security
    }, sessionId);
    
    if (error.response) {
      const errorData = error.response.data;
      const truncatedData = typeof errorData === 'string' 
        ? errorData.substring(0, 200) + (errorData.length > 200 ? '...' : '')
        : JSON.stringify(errorData).substring(0, 200) + (JSON.stringify(errorData).length > 200 ? '...' : '');
      
      logger.n8n('Error', `API responded with status ${error.response.status}`, {
        status: error.response.status,
        data: truncatedData
      }, sessionId);
    }
    
    // Re-throw the error to be handled by the caller
    throw error;
  }
}

module.exports = {
  forwardToN8n
};
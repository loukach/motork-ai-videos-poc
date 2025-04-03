/**
 * Configuration settings
 */

module.exports = {
  // Server configuration
  port: process.env.PORT || 3000,
  
  // API URLs
  apiBaseUrl: 'https://carspark-api.dealerk.com',
  authApiUrl: 'https://auth.motork.io/realms/prod/protocol/openid-connect/token',
  
  // Default settings
  defaultCountry: 'it',
  
  // File upload limits
  uploadLimits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  
  // Task management
  taskRetention: {
    hours: 24,
    cleanupInterval: 60 * 60 * 1000 // 1 hour
  }
};
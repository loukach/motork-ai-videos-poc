/**
 * Utility Tests
 */

const { handleApiError } = require('../utils/error-handler');
const { requireAuth } = require('../utils/auth-middleware');
const logger = require('../utils/logger');

// Mock console.log/error to avoid cluttering test output
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('Utilities', () => {
  describe('Error Handler', () => {
    test('should handle API errors with response', () => {
      // Create mock objects
      const error = new Error('API error');
      error.response = {
        status: 400,
        data: { message: 'Bad request' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      
      // Call the handler
      handleApiError(error, res, 'Test operation');
      
      // Check the response
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Bad request' });
      expect(console.error).toHaveBeenCalled();
    });
    
    test('should handle API errors without response', () => {
      // Create mock objects
      const error = new Error('Generic error');
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      
      // Call the handler
      handleApiError(error, res, 'Test operation');
      
      // Check the response
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('Auth Middleware', () => {
    test('should call next() when auth header is present', () => {
      // Create mock objects
      const req = {
        headers: {
          authorization: 'Bearer test-token'
        },
        query: {}
      };
      const res = {};
      const next = jest.fn();
      
      // Call the middleware
      requireAuth(req, res, next);
      
      // Check the results
      expect(next).toHaveBeenCalled();
      expect(req.authToken).toBe('Bearer test-token');
      expect(req.country).toBe('it'); // Default country
    });
    
    test('should return 401 when auth header is missing', () => {
      // Create mock objects
      const req = {
        headers: {},
        query: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();
      
      // Call the middleware
      requireAuth(req, res, next);
      
      // Check the results
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authorization header required' });
    });
    
    test('should use country from query params if provided', () => {
      // Create mock objects
      const req = {
        headers: {
          authorization: 'Bearer test-token'
        },
        query: {
          country: 'fr'
        }
      };
      const res = {};
      const next = jest.fn();
      
      // Call the middleware
      requireAuth(req, res, next);
      
      // Check the results
      expect(next).toHaveBeenCalled();
      expect(req.country).toBe('fr');
    });
  });

  describe('Logger', () => {
    test('should format log messages with area', () => {
      logger.info('TestArea', 'Test message');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[TestArea]'));
    });
    
    test('should include data in log messages', () => {
      const testData = { key: 'value' };
      logger.info('TestArea', 'Test message', testData);
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/key.*value/));
    });
    
    test('should include ID in log prefix if provided', () => {
      logger.info('TestArea', 'Test message', null, 'TestID');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[TestArea][TestID]'));
    });
  });
});
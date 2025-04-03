/**
 * Tests for N8N Service
 */

const axios = require('axios');
const n8nService = require('../services/n8n-service');
const config = require('../utils/config');

// Mock axios
jest.mock('axios');

describe('N8N Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should forward message to test webhook when not in production', async () => {
    // Store original NODE_ENV and console.log
    const originalEnv = process.env.NODE_ENV;
    const originalConsoleLog = console.log;
    console.log = jest.fn(); // Mock console.log to prevent test output noise
    
    process.env.NODE_ENV = 'development';
    
    // Mock the axios response
    const mockResponse = { data: { responseMessage: 'Test response' } };
    axios.mockResolvedValue(mockResponse);
    
    // Test data
    const sessionId = 'test-session-123';
    const message = 'Hello, this is a test message';
    const page = 'test-page';
    const authToken = 'Bearer test-token';
    
    // Call the service function
    const result = await n8nService.forwardToN8n({ 
      sessionId, 
      message, 
      page,
      authToken
    });
    
    // Restore original console.log
    console.log = originalConsoleLog;
    
    // Verify axios was called with the right parameters
    expect(axios).toHaveBeenCalledWith({
      method: 'post',
      url: config.n8n.testWebhookUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken
      },
      data: {
        sessionId,
        message,
        page
      }
    });
    
    // Verify the function returned the expected result
    expect(result).toEqual(mockResponse.data);
    
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalEnv;
  });

  it('should forward message to prod webhook when in production', async () => {
    // Store original NODE_ENV and console.log
    const originalEnv = process.env.NODE_ENV;
    const originalConsoleLog = console.log;
    console.log = jest.fn(); // Mock console.log to prevent test output noise
    
    process.env.NODE_ENV = 'production';
    
    // Mock the axios response
    const mockResponse = { data: { responseMessage: 'Production response' } };
    axios.mockResolvedValue(mockResponse);
    
    // Test data
    const sessionId = 'prod-session-456';
    const message = 'Hello, this is a production message';
    
    // Call the service function (without page parameter or auth token)
    const result = await n8nService.forwardToN8n({ 
      sessionId, 
      message 
    });
    
    // Restore original console.log
    console.log = originalConsoleLog;
    
    // Verify axios was called with the right parameters
    expect(axios).toHaveBeenCalledWith({
      method: 'post',
      url: config.n8n.prodWebhookUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        sessionId,
        message,
        page: undefined
      }
    });
    
    // Verify the function returned the expected result
    expect(result).toEqual(mockResponse.data);
    
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalEnv;
  });

  it('should handle errors correctly', async () => {
    // Store original console.log
    const originalConsoleLog = console.log;
    console.log = jest.fn(); // Mock console.log to prevent test output noise
    
    // Mock axios to throw an error
    const mockError = {
      message: 'Error connecting to n8n',
      response: {
        status: 503,
        data: { error: 'Service unavailable' }
      }
    };
    axios.mockRejectedValue(mockError);
    
    // Test data
    const sessionId = 'error-session-789';
    const message = 'This will cause an error';
    
    // Call the service function and expect it to throw
    await expect(n8nService.forwardToN8n({ sessionId, message }))
      .rejects.toEqual(mockError);
      
    // Restore original console.log
    console.log = originalConsoleLog;
  });
  
  it('should properly handle JSON string responses', async () => {
    // Store original console.log
    const originalConsoleLog = console.log;
    console.log = jest.fn(); // Mock console.log to prevent test output noise
    
    // Mock a response that contains a JSON string
    const jsonData = [
      { make: "Honda", model: "e", vehicleId: "7026438" },
      { make: "Honda", model: "e", vehicleId: "7199514" }
    ];
    const mockResponse = { data: JSON.stringify(jsonData) };
    axios.mockResolvedValue(mockResponse);
    
    // Test data
    const sessionId = 'json-session-123';
    const message = 'How many honda are in stock?';
    
    // Call the service function
    const result = await n8nService.forwardToN8n({ 
      sessionId, 
      message
    });
    
    // Verify the result is the JSON string (preserved as-is)
    expect(result).toEqual(JSON.stringify(jsonData));
    
    // Verify console.log was called with the formatted JSON
    expect(console.log).toHaveBeenCalledWith(`\n----- N8N JSON RESPONSE [${sessionId}] -----`);
    
    // Restore original console.log
    console.log = originalConsoleLog;
  });
});
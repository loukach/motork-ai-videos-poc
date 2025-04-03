/**
 * Endpoint tests
 */

const request = require('supertest');
const express = require('express');

// Mock services
jest.mock('../services/vehicle-service', () => ({
  listVehicles: jest.fn(),
  getVehicleDetails: jest.fn(),
  getVehicleImages: jest.fn(),
  updateVehicleField: jest.fn()
}));

jest.mock('../services/task-service', () => ({
  createVideoTask: jest.fn(),
  getTaskStatus: jest.fn(),
  updateTask: jest.fn(),
  startCleanupTimer: jest.fn(),
  getTask: jest.fn()
}));

// Mock axios
jest.mock('axios');

const vehicleService = require('../services/vehicle-service');
const taskService = require('../services/task-service');
const axios = require('axios');

// Mock n8n service
jest.mock('../services/n8n-service', () => ({
  forwardToN8n: jest.fn()
}));
const n8nService = require('../services/n8n-service');

// Set environment to test
process.env.NODE_ENV = 'test';

// Import the app - we need to require it after mocking dependencies
let app;

describe('API Endpoints', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Load the app without starting the server
    app = require('../server');
  });

  describe('Authentication', () => {
    test('POST /auth/token should return token on successful auth', async () => {
      // Mock axios for this test
      axios.mockResolvedValue({
        status: 200,
        data: {
          access_token: 'test-token',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'openid'
        }
      });
      
      const response = await request(app)
        .post('/auth/token')
        .send({
          username: 'testuser',
          password: 'testpass',
          grant_type: 'password'
        });
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });
  });

  describe('Vehicle Endpoints', () => {
    test('GET /vehicles should return list of vehicles', async () => {
      // Mock the service response
      const mockVehicles = {
        vehicles: [
          { id: 'vehicle1', brand: 'Toyota', model: 'Corolla' },
          { id: 'vehicle2', brand: 'Honda', model: 'Civic' }
        ],
        totalVehicles: 2,
        totalPages: 1,
        size: 10
      };
      
      vehicleService.listVehicles.mockResolvedValueOnce(mockVehicles);
      
      const response = await request(app)
        .get('/vehicles')
        .set('Authorization', 'Bearer test-token');
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('vehicles');
      expect(response.body.vehicles).toHaveLength(2);
      expect(vehicleService.listVehicles).toHaveBeenCalled();
    });
    
    test('GET /vehicles should return 401 without auth token', async () => {
      const response = await request(app).get('/vehicles');
      expect(response.status).toBe(401);
    });

    test('GET /vehicle/:vehicleId should return a single vehicle', async () => {
      // Mock the service response
      const mockVehicle = {
        id: 'vehicle1', 
        brand: 'Toyota', 
        model: 'Corolla',
        year: 2022,
        exteriorColorName: 'Red'
      };
      
      vehicleService.getVehicleDetails.mockResolvedValueOnce(mockVehicle);
      
      const response = await request(app)
        .get('/vehicle/vehicle1')
        .set('Authorization', 'Bearer test-token');
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'vehicle1');
      expect(vehicleService.getVehicleDetails).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: 'vehicle1'
        })
      );
    });

    test('GET /vehicle/:vehicleId/images/gallery should return vehicle images', async () => {
      // Mock the service response
      const mockImages = [
        { id: 'img1', url: 'http://example.com/img1.jpg' },
        { id: 'img2', url: 'http://example.com/img2.jpg' }
      ];
      
      vehicleService.getVehicleImages.mockResolvedValueOnce(mockImages);
      
      const response = await request(app)
        .get('/vehicle/vehicle1/images/gallery')
        .set('Authorization', 'Bearer test-token');
        
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(vehicleService.getVehicleImages).toHaveBeenCalled();
    });

    test('PUT /vehicle/:vehicleId/update-field should update vehicle field', async () => {
      // Mock the service response
      const mockUpdateResponse = {
        success: true,
        vehicleId: 'vehicle1',
        updatedField: 'videoUrl',
        oldValue: null,
        newValue: 'http://example.com/video.mp4',
        id: 'vehicle1'
      };
      
      vehicleService.updateVehicleField.mockResolvedValueOnce(mockUpdateResponse);
      
      const response = await request(app)
        .put('/vehicle/vehicle1/update-field')
        .set('Authorization', 'Bearer test-token')
        .send({
          field: 'videoUrl',
          value: 'http://example.com/video.mp4'
        });
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('updatedField', 'videoUrl');
      expect(vehicleService.updateVehicleField).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: 'vehicle1',
          field: 'videoUrl',
          value: 'http://example.com/video.mp4'
        })
      );
    });
  });

  describe('Video Task Endpoints', () => {
    test('GET /vehicle/video/:taskId should return task status', async () => {
      // Mock task status
      const mockTask = {
        taskId: 'task123',
        vehicleId: 'vehicle1',
        status: 'completed',
        createdAt: '2023-01-01T00:00:00.000Z',
        completedAt: '2023-01-01T00:01:00.000Z',
        videoUrl: 'http://example.com/video.mp4',
        runwayTaskId: 'runway123',
        vehicleUpdated: true
      };
      
      // Need to mock both getTask and getTaskStatus for the endpoint to work
      taskService.getTask.mockReturnValueOnce(mockTask);
      taskService.getTaskStatus.mockReturnValueOnce(mockTask);
      
      const response = await request(app)
        .get('/vehicle/video/task123');
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('taskId', 'task123');
      expect(response.body).toHaveProperty('status', 'completed');
      expect(taskService.getTaskStatus).toHaveBeenCalledWith('task123');
    });
    
    test('GET /vehicle/video/:taskId should return 404 for non-existent task', async () => {
      // Mock both functions to return null
      taskService.getTask.mockReturnValueOnce(null);
      taskService.getTaskStatus.mockReturnValueOnce(null);
      
      const response = await request(app)
        .get('/vehicle/video/nonexistent');
        
      expect(response.status).toBe(404);
    });
  });

  describe('N8N Proxy Endpoint', () => {
    test('POST /n8n-proxy should forward request to n8n with JSON object response', async () => {
      // Mock n8n service response as an object
      const mockResponse = {
        message: 'Processed by n8n',
        data: { 
          result: 'success',
          aiResponse: 'This is an AI generated response'
        }
      };
      
      n8nService.forwardToN8n.mockResolvedValueOnce(mockResponse);
      
      const response = await request(app)
        .post('/n8n-proxy')
        .set('Authorization', 'Bearer test-token')
        .send({
          sessionId: 'test-session-123',
          message: 'Hello, AI assistant',
          page: 'product-detail'
        });
        
      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResponse);
      expect(n8nService.forwardToN8n).toHaveBeenCalledWith({
        sessionId: 'test-session-123',
        message: 'Hello, AI assistant',
        page: 'product-detail',
        authToken: 'Bearer test-token',
        logPrefix: 'N8NProxy'
      });
    });
    
    test('POST /n8n-proxy should forward request to n8n with JSON string response', async () => {
      // Mock n8n service response as a JSON string
      const jsonData = [
        { make: "Honda", model: "e", vehicleId: "7026438" },
        { make: "Honda", model: "e", vehicleId: "7199514" }
      ];
      const jsonString = JSON.stringify(jsonData);
      
      n8nService.forwardToN8n.mockResolvedValueOnce(jsonString);
      
      const response = await request(app)
        .post('/n8n-proxy')
        .send({
          sessionId: 'json-session-123',
          message: 'How many honda are in stock?'
        });
        
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      
      // The response body should be the parsed JSON
      expect(JSON.stringify(response.body)).toEqual(jsonString);
      expect(n8nService.forwardToN8n).toHaveBeenCalledWith({
        sessionId: 'json-session-123',
        message: 'How many honda are in stock?',
        page: undefined,
        authToken: undefined,
        logPrefix: 'N8NProxy'
      });
    });
    
    test('POST /n8n-proxy should return 400 if required fields are missing', async () => {
      // Test with missing sessionId
      const response1 = await request(app)
        .post('/n8n-proxy')
        .send({
          message: 'Hello, AI assistant'
        });
        
      expect(response1.status).toBe(400);
      expect(response1.body).toHaveProperty('error');
      
      // Test with missing message
      const response2 = await request(app)
        .post('/n8n-proxy')
        .send({
          sessionId: 'test-session-123'
        });
        
      expect(response2.status).toBe(400);
      expect(response2.body).toHaveProperty('error');
    });
    
    test('POST /n8n-proxy should handle errors from n8n service', async () => {
      // Mock n8n service to throw an error
      const mockError = new Error('Failed to connect to n8n');
      mockError.response = {
        status: 500,
        data: { error: 'Internal server error' }
      };
      
      n8nService.forwardToN8n.mockRejectedValueOnce(mockError);
      
      const response = await request(app)
        .post('/n8n-proxy')
        .send({
          sessionId: 'test-session-123',
          message: 'This will cause an error'
        });
        
      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
  });
});
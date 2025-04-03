/**
 * Vehicle Service Tests
 */

const axios = require('axios');
const vehicleService = require('../services/vehicle-service');

// Mock axios
jest.mock('axios');

describe('Vehicle Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('listVehicles', () => {
    test('should return a list of vehicles', async () => {
      // Mock response data
      const mockVehicles = {
        content: [
          { id: 'vehicle1', brand: 'Toyota', model: 'Corolla' },
          { id: 'vehicle2', brand: 'Honda', model: 'Civic' }
        ],
        totalElements: 2,
        totalPages: 1,
        size: 10
      };
      
      // Setup axios mock
      axios.mockResolvedValueOnce({
        data: mockVehicles
      });
      
      // Call the service
      const result = await vehicleService.listVehicles({
        authToken: 'test-token',
        page: 0,
        size: 10
      });
      
      // Check results
      expect(result).toEqual(mockVehicles);
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'get',
        headers: expect.objectContaining({
          'Authorization': 'test-token'
        })
      }));
    });
    
    test('should handle errors', async () => {
      // Setup axios to throw an error
      const error = new Error('API error');
      error.response = { status: 500, data: { message: 'Server error' } };
      axios.mockRejectedValueOnce(error);
      
      // Expect the service to throw the error
      await expect(vehicleService.listVehicles({
        authToken: 'test-token'
      })).rejects.toThrow();
    });
  });

  describe('getVehicleDetails', () => {
    test('should return vehicle details', async () => {
      // Mock response data
      const mockVehicle = {
        id: 'vehicle1',
        brand: 'Toyota',
        model: 'Corolla',
        year: 2022
      };
      
      // Setup axios mock
      axios.mockResolvedValueOnce({
        data: mockVehicle
      });
      
      // Call the service
      const result = await vehicleService.getVehicleDetails({
        vehicleId: 'vehicle1',
        authToken: 'test-token'
      });
      
      // Check results
      expect(result).toEqual(mockVehicle);
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'get',
        headers: expect.objectContaining({
          'Authorization': 'test-token',
          'Accept': 'application/json'
        })
      }));
    });
  });

  describe('getVehicleImages', () => {
    test('should return vehicle images', async () => {
      // Mock response data
      const mockImages = [
        { id: 'img1', url: 'http://example.com/img1.jpg' },
        { id: 'img2', url: 'http://example.com/img2.jpg' }
      ];
      
      // Setup axios mock
      axios.mockResolvedValueOnce({
        data: mockImages
      });
      
      // Call the service
      const result = await vehicleService.getVehicleImages({
        vehicleId: 'vehicle1',
        authToken: 'test-token'
      });
      
      // Check results
      expect(result).toEqual(mockImages);
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'get',
        headers: expect.objectContaining({
          'Authorization': 'test-token',
          'Accept': '*/*'
        })
      }));
    });
  });
});
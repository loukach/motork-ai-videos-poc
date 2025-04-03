/**
 * Vehicle Service
 * Handles vehicle data operations
 */

const axios = require('axios');
const config = require('../utils/config');
const logger = require('../utils/logger');

/**
 * Lists vehicles with pagination
 * 
 * @param {Object} options - List options
 * @param {string} options.authToken - Authentication token
 * @param {number} options.page - Page number (default: 0)
 * @param {number} options.size - Page size (default: 10)
 * @param {string} options.country - Country code (default: 'it')
 * @param {string} options.logPrefix - Prefix for log messages
 * @returns {Promise<Object>} List of vehicles with pagination info
 */
async function listVehicles({
  authToken,
  page = 0,
  size = 10,
  country = 'it',
  logPrefix = ''
}) {
  try {
    logger.info('Vehicles', `Listing vehicles (page=${page}, size=${size})`, null, logPrefix);
    
    const response = await axios({
      method: 'get',
      url: `${config.apiBaseUrl}/${country}/vehicle?page=${page}&size=${size}`,
      headers: {
        'Authorization': authToken
      }
    });
    
    logger.info('Vehicles', `Found ${response.data.content?.length || 0} vehicles (total: ${response.data.totalElements || 0})`, null, logPrefix);
    return response.data;
  } catch (error) {
    logger.error('Vehicles', `Failed to list vehicles: ${error.message}`, error.response?.data, logPrefix);
    throw error;
  }
}

/**
 * Updates a vehicle field
 * 
 * @param {Object} options - Update options
 * @param {string} options.vehicleId - ID of the vehicle to update
 * @param {string} options.field - Field name to update
 * @param {string} options.value - New value for the field
 * @param {string} options.authToken - Authentication token
 * @param {string} options.apiBaseUrl - Base URL for the API
 * @param {string} options.country - Country code (default: 'it')
 * @param {string} options.logPrefix - Prefix for log messages
 * @returns {Promise<Object>} Update response
 */
async function updateVehicleField({
  vehicleId,
  field,
  value,
  authToken,
  apiBaseUrl,
  country = 'it',
  logPrefix = ''
}) {
  const logTag = logPrefix ? `[${logPrefix}]` : '';
  console.log(`${logTag} 🚗 Updating vehicle ${vehicleId} ${field} field...`);
  console.log(`${logTag} Field: ${field}, Value: ${value}`);
  
  const updateStartTime = new Date();
  
  try {
    // Step 1: Get current vehicle data
    console.log(`${logTag} Fetching current vehicle data...`);
    const vehicleResponse = await axios({
      method: 'get',
      url: `${config.apiBaseUrl}/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authToken,
        'Accept': 'application/json'
      }
    });
    
    const vehicleData = vehicleResponse.data;
    
    // Step 2: Update the specified field
    if (!(field in vehicleData)) {
      throw new Error(`Field '${field}' not found in vehicle data`);
    }
    
    console.log(`${logTag} Changing field '${field}' from '${vehicleData[field] || 'empty'}' to '${value}'`);
    vehicleData[field] = value;
    
    // Step 3: Send updated data back to the API
    console.log(`${logTag} Sending updated vehicle data...`);
    const updateResponse = await axios({
      method: 'put',
      url: `${config.apiBaseUrl}/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: vehicleData
    });
    
    const updateTime = Math.round(new Date() - updateStartTime);
    console.log(`${logTag} ✅ Vehicle ${vehicleId} ${field} updated successfully in ${updateTime}ms`);
    
    return {
      success: true,
      vehicleId,
      updatedField: field,
      oldValue: vehicleResponse.data[field],
      newValue: value,
      updateTime,
      ...updateResponse.data
    };
  } catch (error) {
    const updateTime = Math.round(new Date() - updateStartTime);
    console.error(`${logTag} ❌ Failed to update vehicle ${field} after ${updateTime}ms: ${error.message}`);
    
    if (error.response) {
      console.error(`${logTag} Response status: ${error.response.status}`);
      if (error.response.data) {
        console.error(`${logTag} Response data:`, JSON.stringify(error.response.data));
      }
    }
    
    throw error;
  }
}

/**
 * Gets a vehicle's details
 * 
 * @param {Object} options - Request options
 * @param {string} options.vehicleId - ID of the vehicle
 * @param {string} options.authToken - Authentication token
 * @param {string} options.country - Country code (default: 'it')
 * @param {string} options.logPrefix - Prefix for log messages
 * @returns {Promise<Object>} Vehicle data
 */
async function getVehicleDetails({
  vehicleId,
  authToken,
  country = 'it',
  logPrefix = ''
}) {
  const logTag = logPrefix ? `[${logPrefix}]` : '';
  console.log(`${logTag} 🔍 Fetching vehicle ${vehicleId} details...`);
  
  try {
    const response = await axios({
      method: 'get',
      url: `${config.apiBaseUrl}/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authToken,
        'Accept': 'application/json'
      }
    });
    
    console.log(`${logTag} ✅ Found vehicle: ${response.data.brand} ${response.data.model}`);
    return response.data;
  } catch (error) {
    console.error(`${logTag} ❌ Failed to fetch vehicle details: ${error.message}`);
    if (error.response) {
      console.error(`${logTag} Response status: ${error.response.status}`);
    }
    throw error;
  }
}

/**
 * Gets a vehicle's gallery images
 * 
 * @param {Object} options - Request options
 * @param {string} options.vehicleId - ID of the vehicle
 * @param {string} options.authToken - Authentication token
 * @param {string} options.country - Country code (default: 'it')
 * @param {string} options.logPrefix - Prefix for log messages
 * @returns {Promise<Array>} Vehicle images
 */
async function getVehicleImages({
  vehicleId,
  authToken,
  country = 'it',
  logPrefix = ''
}) {
  const logTag = logPrefix ? `[${logPrefix}]` : '';
  console.log(`${logTag} 🖼️ Fetching vehicle ${vehicleId} gallery images...`);
  
  try {
    const response = await axios({
      method: 'get',
      url: `${config.apiBaseUrl}/${country}/vehicle/${vehicleId}/images/gallery`,
      headers: {
        'Authorization': authToken,
        'Accept': '*/*'
      }
    });
    
    const imageCount = Array.isArray(response.data) ? response.data.length : 0;
    console.log(`${logTag} ✅ Found ${imageCount} images`);
    return response.data;
  } catch (error) {
    console.error(`${logTag} ❌ Failed to fetch vehicle images: ${error.message}`);
    if (error.response) {
      console.error(`${logTag} Response status: ${error.response.status}`);
    }
    throw error;
  }
}

module.exports = {
  listVehicles,
  updateVehicleField,
  getVehicleDetails,
  getVehicleImages
};
/**
 * Runway API Service
 * Handles communication with the Runway ML API
 */

// Initialize Runway SDK
let runway = null;
try {
  // Import the SDK
  const RunwayML = require('@runwayml/sdk');
  
  // Initialize the SDK with API key
  const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
  if (RUNWAY_API_KEY) {
    // Pass the API key as an object with the apiKey property
    runway = new RunwayML({ apiKey: RUNWAY_API_KEY });
    console.log('Runway SDK initialized successfully');
  } else {
    console.warn('Runway API key not found in environment variables');
  }
} catch (error) {
  console.error('Error initializing Runway SDK:', error.message);
}

/**
 * Create a video generation task in Runway
 * @param {Object} options - Task creation options
 * @param {string} options.promptText - The text prompt for generation
 * @param {string} options.promptImage - URL of the source image
 * @param {string} options.model - Runway model to use
 * @param {number} options.duration - Video duration in seconds
 * @param {Object} options.parameters - Additional parameters (style, etc)
 * @returns {Promise<Object>} Task response with ID
 */
async function createImageToVideoTask(options) {
  if (!runway) {
    throw new Error('Runway SDK is not available. Make sure the API key is set and the SDK is properly installed.');
  }
  
  return await runway.imageToVideo.create(options);
}

/**
 * Retrieve the status of a task
 * @param {string} taskId - The Runway task ID
 * @returns {Promise<Object>} Task status details
 */
async function getTaskStatus(taskId) {
  if (!runway) {
    throw new Error('Runway SDK is not available');
  }
  
  return await runway.tasks.retrieve(taskId);
}

/**
 * Check if the Runway SDK is available
 * @returns {boolean} Whether the SDK is ready to use
 */
function isSDKAvailable() {
  return runway !== null;
}

module.exports = {
  createImageToVideoTask,
  getTaskStatus,
  isSDKAvailable
};
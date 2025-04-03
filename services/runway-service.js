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
 * @param {string|Array} options.promptImage - URL of the source image or array of image URLs
 * @param {string} options.model - Runway model to use
 * @param {number} options.duration - Video duration in seconds
 * @param {Object} options.parameters - Additional parameters (style, etc)
 * @returns {Promise<Object>} Task response with ID
 */
async function createImageToVideoTask(options) {
  if (!runway) {
    throw new Error('Runway SDK is not available. Make sure the API key is set and the SDK is properly installed.');
  }
  
  // Process promptImage to handle both string and array formats
  const taskOptions = { ...options };
  
  // Handle array of image URLs
  if (Array.isArray(options.promptImage) && options.promptImage.length > 0) {
    // Format the first two images (or just one if that's all we have)
    const formattedImages = [];
    
    if (options.promptImage.length >= 1) {
      formattedImages.push({
        uri: options.promptImage[0],
        position: "first"
      });
    }
    
    if (options.promptImage.length >= 2) {
      formattedImages.push({
        uri: options.promptImage[1],
        position: "last"
      });
    }
    
    // Replace promptImage with the formatted array
    taskOptions.promptImage = formattedImages;
  }
  // If it's a string (single URL), leave it as is
  
  return await runway.imageToVideo.create(taskOptions);
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
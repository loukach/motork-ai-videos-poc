/**
 * Runway API Service
 * Handles communication with the Runway ML API
 */

const logger = require('../utils/logger');

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
    logger.info('Runway', 'SDK initialized successfully');
  } else {
    logger.warn('Runway', 'API key not found in environment variables');
  }
} catch (error) {
  logger.error('Runway', 'Error initializing SDK', { error: error.message });
}

/**
 * Create a video generation task in Runway
 * @param {Object} options - Task creation options
 * @param {string} options.promptText - The text prompt for generation
 * @param {string|Array} options.promptImage - URL of the source image or array of image URLs
 * @param {string} options.model - Runway model to use
 * @param {number} options.duration - Video duration in seconds (Supported values: 5, 10)
 * @param {string} options.ratio - Output video resolution/aspect ratio (Supported values: "1280:768", "768:1280")
 * @param {Object} options.parameters - Additional parameters (style, etc)
 * @param {string} [options.taskId] - Optional task ID for logging
 * @returns {Promise<Object>} Task response with ID
 */
async function createImageToVideoTask(options) {
  const taskId = options.taskId || 'unknown';
  
  if (!runway) {
    logger.error('Runway', 'SDK not available', null, taskId);
    throw new Error('Runway SDK is not available. Make sure the API key is set and the SDK is properly installed.');
  }
  
  // Process promptImage to handle both string and array formats
  const taskOptions = { ...options };
  delete taskOptions.taskId; // Remove our custom property before sending to Runway API
  
  logger.runway('CreateTask', 'Starting new video generation task', {
    model: taskOptions.model,
    style: taskOptions.parameters?.style || 'default',
    imageCount: Array.isArray(taskOptions.promptImage) ? taskOptions.promptImage.length : 1
  }, taskId);
  
  // Validate and set defaults for duration if provided (must be 5 or 10)
  if (taskOptions.duration !== undefined) {
    const validDurations = [5, 10];
    if (!validDurations.includes(taskOptions.duration)) {
      logger.warn('Runway', `Invalid duration value: ${taskOptions.duration}. Defaulting to 5.`, null, taskId);
      taskOptions.duration = 5;
    }
  }
  
  // Validate and set defaults for ratio if provided
  if (taskOptions.ratio !== undefined) {
    const validRatios = ["1280:768", "768:1280"];
    if (!validRatios.includes(taskOptions.ratio)) {
      logger.warn('Runway', `Invalid ratio value: ${taskOptions.ratio}. Defaulting to "1280:768".`, null, taskId);
      taskOptions.ratio = "1280:768";
    }
  }
  
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
    logger.runway('CreateTask', `Using ${formattedImages.length} images for interpolation`, null, taskId);
  }
  // If it's a string (single URL), leave it as is
  
  try {
    // Log the final parameters being sent to Runway
    console.log('\n----- RUNWAY API REQUEST PARAMETERS -----');
    console.log('taskId:', taskId);
    console.log('duration:', taskOptions.duration, '(type:', typeof taskOptions.duration, ')');
    console.log('ratio:', taskOptions.ratio);
    console.log('style:', taskOptions.parameters?.style);
    console.log('model:', taskOptions.model);
    console.log('------------------------------------------');
    
    const result = await runway.imageToVideo.create(taskOptions);
    logger.runway('CreateTask', 'Task created successfully', {
      runwayTaskId: result.taskId || result.id,
      duration: taskOptions.duration,
      ratio: taskOptions.ratio
    }, taskId);
    return result;
  } catch (error) {
    logger.error('Runway', `API call failed: ${error.message}`, {
      error: error.message,
      stack: error.stack
    }, taskId);
    throw error;
  }
}

/**
 * Retrieve the status of a task
 * @param {string} taskId - The Runway task ID
 * @param {string} [localTaskId] - Optional local task ID for logging
 * @returns {Promise<Object>} Task status details
 */
async function getTaskStatus(taskId, localTaskId) {
  const logId = localTaskId || taskId.substring(0, 8);
  
  if (!runway) {
    logger.error('Runway', 'SDK not available', null, logId);
    throw new Error('Runway SDK is not available');
  }
  
  try {
    logger.runway('CheckStatus', `Polling task status`, null, logId);
    const result = await runway.tasks.retrieve(taskId);
    logger.runway('CheckStatus', `Current status: ${result.status}`, null, logId);
    return result;
  } catch (error) {
    logger.error('Runway', `Failed to retrieve task status: ${error.message}`, null, logId);
    throw error;
  }
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
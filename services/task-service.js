/**
 * Task Service
 * Manages video generation tasks storage and lifecycle
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// In-memory storage for video generation tasks
const videoTasks = new Map();

// Setup history directory if it doesn't exist
const historyDir = path.join(__dirname, '..', 'data', 'task-history');
try {
  if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
    fs.mkdirSync(path.join(__dirname, '..', 'data'));
  }
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir);
  }
} catch (err) {
  logger.warn('TaskService', `Could not initialize task history directory: ${err.message}`);
}

/**
 * Creates a new video generation task
 * @param {string} vehicleId - Vehicle ID
 * @param {object} vehicleData - Basic vehicle data to store with task
 * @param {object} [videoOptions] - Optional video generation options
 * @param {number} [videoOptions.duration] - Video duration in seconds
 * @param {string} [videoOptions.ratio] - Video aspect ratio
 * @param {string} [videoOptions.style] - Video style
 * @returns {string} Task ID
 */
function createVideoTask(vehicleId, vehicleData, videoOptions = {}) {
  // Generate a unique task ID
  const taskId = Date.now().toString();
  
  // Store task in memory with video options
  videoTasks.set(taskId, {
    vehicleId,
    status: 'processing',
    createdAt: new Date().toISOString(),
    vehicleData: {
      id: vehicleData.id,
      brand: vehicleData.brand,
      model: vehicleData.model,
      year: vehicleData.year,
      color: vehicleData.exteriorColorName || 'Unknown'
    },
    videoOptions: {
      duration: videoOptions.duration,
      ratio: videoOptions.ratio,
      style: videoOptions.style
    }
  });
  
  const videoParams = [];
  if (videoOptions.duration) videoParams.push(`${videoOptions.duration}s`);
  if (videoOptions.ratio) videoParams.push(`${videoOptions.ratio} ratio`);
  if (videoOptions.style) videoParams.push(`${videoOptions.style} style`);
  
  const videoParamsStr = videoParams.length > 0 ? ` with ${videoParams.join(', ')}` : '';
  logger.info('TaskService', `Created new task for vehicle ${vehicleId}${videoParamsStr}`, null, taskId);
  
  return taskId;
}

/**
 * Updates task information
 * @param {string} taskId - Task ID
 * @param {object} updateData - Data to update
 * @returns {object} Updated task
 */
function updateTask(taskId, updateData) {
  if (!videoTasks.has(taskId)) {
    throw new Error(`Task not found: ${taskId}`);
  }
  
  const task = videoTasks.get(taskId);
  const updatedTask = { ...task, ...updateData };
  videoTasks.set(taskId, updatedTask);
  
  logger.debug('TaskService', `Updated task`, { status: updatedTask.status }, taskId);
  
  // If task status is changing to completed or failed, save to history
  if ((updateData.status === 'completed' || updateData.status === 'failed') && 
      task.status !== 'completed' && task.status !== 'failed') {
    saveTaskToHistory(taskId, updatedTask);
  }
  
  return updatedTask;
}

/**
 * Saves a task to the history file
 * @param {string} taskId - Task ID
 * @param {object} task - Task data
 */
function saveTaskToHistory(taskId, task) {
  try {
    // Create a history entry with important task data
    const historyEntry = {
      taskId,
      vehicleId: task.vehicleId,
      status: task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt || new Date().toISOString(),
      videoUrl: task.videoUrl,
      error: task.error,
      duration: task.videoOptions?.duration,
      style: task.videoOptions?.style,
      vehicleInfo: task.vehicleData ? {
        brand: task.vehicleData.brand,
        model: task.vehicleData.model,
        year: task.vehicleData.year
      } : null,
      processingTimeSeconds: task.completedAt ? 
        Math.round((new Date(task.completedAt) - new Date(task.createdAt))/1000) : null
    };
    
    // Save to a date-based directory to avoid too many files in one directory
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const monthDir = path.join(historyDir, today.substring(0, 7)); // YYYY-MM
    
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true });
    }
    
    const historyFile = path.join(monthDir, `${taskId}.json`);
    fs.writeFileSync(historyFile, JSON.stringify(historyEntry, null, 2));
    
    logger.info('TaskService', `Saved task history`, { 
      taskId, 
      status: task.status,
      historyFile: path.relative(__dirname, historyFile)
    });
  } catch (err) {
    logger.warn('TaskService', `Failed to save task history: ${err.message}`, { taskId });
  }
}

/**
 * Gets task information
 * @param {string} taskId - Task ID
 * @returns {object} Task data
 */
function getTask(taskId) {
  if (!videoTasks.has(taskId)) {
    return null;
  }
  
  return videoTasks.get(taskId);
}

/**
 * Gets task status info suitable for API response
 * @param {string} taskId - Task ID
 * @returns {object} Task status data
 */
function getTaskStatus(taskId) {
  if (!videoTasks.has(taskId)) {
    return null;
  }
  
  const task = videoTasks.get(taskId);
  
  return {
    taskId,
    vehicleId: task.vehicleId,
    status: task.status,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    videoUrl: task.status === 'completed' ? task.videoUrl : undefined,
    originalVideoUrl: task.status === 'completed' ? task.originalVideoUrl : undefined,
    runwayTaskId: task.runwayTaskId,
    vehicleUpdated: task.vehicleUpdated || false,
    error: task.error,
    videoOptions: task.videoOptions // Include video options in the response
  };
}

/**
 * Removes tasks older than the configured retention period
 */
function cleanupOldTasks() {
  const now = new Date();
  const retentionMs = config.taskRetention.hours * 60 * 60 * 1000; // hours to milliseconds
  let removedCount = 0;
  
  for (const [taskId, task] of videoTasks.entries()) {
    const createdAt = new Date(task.createdAt);
    if (now - createdAt > retentionMs) {
      videoTasks.delete(taskId);
      removedCount++;
    }
  }
  
  if (removedCount > 0) {
    logger.info('TaskService', `Cleanup: Removed ${removedCount} tasks older than ${config.taskRetention.hours} hours`);
  }
}

/**
 * Starts the task cleanup timer
 */
function startCleanupTimer() {
  setInterval(cleanupOldTasks, config.taskRetention.cleanupInterval);
  logger.info('TaskService', `Task cleanup scheduled every ${config.taskRetention.cleanupInterval / (60 * 1000)} minutes`);
}

/**
 * Lists task history 
 * @param {object} options - Filter options
 * @param {string} [options.vehicleId] - Filter by vehicle ID
 * @param {string} [options.status] - Filter by status (completed, failed)
 * @param {string} [options.month] - Month to filter by (YYYY-MM format)
 * @param {number} [options.limit=100] - Maximum number of records to return
 * @returns {Array} Array of task history entries
 */
function getTaskHistory(options = {}) {
  try {
    const { vehicleId, status, month, limit = 100 } = options;
    const results = [];
    
    // Determine which directories to scan
    let monthDirs = [];
    if (month) {
      const monthPath = path.join(historyDir, month);
      if (fs.existsSync(monthPath)) {
        monthDirs.push(monthPath);
      }
    } else {
      // Default to scanning all months, newest first
      if (fs.existsSync(historyDir)) {
        monthDirs = fs.readdirSync(historyDir)
          .filter(name => name.match(/^\d{4}-\d{2}$/)) // Only include YYYY-MM directories
          .sort((a, b) => b.localeCompare(a)) // Sort newest first
          .map(name => path.join(historyDir, name));
      }
    }
    
    // Scan directories for matching task files
    for (const dir of monthDirs) {
      if (!fs.existsSync(dir)) continue;
      
      const files = fs.readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Newest first based on filename
      
      for (const file of files) {
        if (results.length >= limit) break;
        
        try {
          const taskData = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          
          // Apply filters
          if (vehicleId && taskData.vehicleId !== vehicleId) continue;
          if (status && taskData.status !== status) continue;
          
          results.push(taskData);
        } catch (err) {
          logger.warn('TaskService', `Error reading task history file: ${file}`, { error: err.message });
        }
      }
      
      if (results.length >= limit) break;
    }
    
    return results;
  } catch (err) {
    logger.error('TaskService', `Failed to get task history: ${err.message}`);
    return [];
  }
}

module.exports = {
  createVideoTask,
  updateTask,
  getTask,
  getTaskStatus,
  cleanupOldTasks,
  startCleanupTimer,
  getTaskHistory
};
/**
 * Task Service
 * Manages video generation tasks storage and lifecycle
 */

const config = require('../utils/config');
const logger = require('../utils/logger');

// In-memory storage for video generation tasks
const videoTasks = new Map();

/**
 * Creates a new video generation task
 * @param {string} vehicleId - Vehicle ID
 * @param {object} vehicleData - Basic vehicle data to store with task
 * @returns {string} Task ID
 */
function createVideoTask(vehicleId, vehicleData) {
  // Generate a unique task ID
  const taskId = Date.now().toString();
  
  // Store task in memory
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
    }
  });
  
  logger.info('TaskService', `Created new task for vehicle ${vehicleId}`, null, taskId);
  
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
  
  return updatedTask;
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
    error: task.error
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

module.exports = {
  createVideoTask,
  updateTask,
  getTask,
  getTaskStatus,
  cleanupOldTasks,
  startCleanupTimer
};
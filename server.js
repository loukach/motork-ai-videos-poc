// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Import utilities
const config = require('./utils/config');
const logger = require('./utils/logger');
const { handleApiError } = require('./utils/error-handler');
const { requireAuth } = require('./utils/auth-middleware');

// Import services
const runwayService = require('./services/runway-service');
const urlShortenerService = require('./services/url-shortener-service');
const vehicleService = require('./services/vehicle-service');
const taskService = require('./services/task-service');
const n8nService = require('./services/n8n-service');

const app = express();
const PORT = config.port;

// Start task cleanup timer
taskService.startCleanupTimer();

// Set default log level to info, but can be changed via environment variable
const envLogLevel = process.env.LOG_LEVEL || 'info';
logger.setLogLevel(envLogLevel);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: config.uploadLimits.fileSize }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Optimized request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const reqId = Date.now().toString(36).slice(-4);
  
  // Log minimal request info
  console.log(`\n----- REQUEST [${reqId}] ${timestamp} -----`);
  console.log(`${req.method} ${req.url}`);
  
  // Log essential query parameters if present
  if (Object.keys(req.query).length > 0) {
    // Only log country parameter if present as it's important
    const relevantParams = {};
    if (req.query.country) relevantParams.country = req.query.country;
    if (Object.keys(relevantParams).length > 0) {
      console.log('Query:', JSON.stringify(relevantParams));
    }
  }
  
  // Only log body for specific endpoints and only relevant fields
  if (req.body && Object.keys(req.body).length > 0) {
    const endpoint = req.path.split('/').pop();
    const relevantBody = {};
    
    // Only include specific fields based on endpoint
    if (endpoint === 'generate-video') {
      // For video generation, only log if a custom prompt was provided
      if (req.body.prompt) relevantBody.prompt = req.body.prompt;
      if (req.body.style) relevantBody.style = req.body.style;
      if (req.body.duration) relevantBody.duration = req.body.duration;
      if (req.body.ratio) relevantBody.ratio = req.body.ratio;
    } else if (endpoint === 'update-field') {
      // For field updates, log which field is being updated
      if (req.body.field) relevantBody.field = req.body.field;
      // Only show value if it's not sensitive (assuming videoUrl is safe)
      if (req.body.field === 'videoUrl' && req.body.value) {
        relevantBody.value = req.body.value;
      }
    } else if (req.url.includes('/auth/token')) {
      // For auth, only show username
      if (req.body.username) relevantBody.username = req.body.username;
      if (req.body.password) relevantBody.password = '[HIDDEN]';
    }
    
    if (Object.keys(relevantBody).length > 0) {
      console.log('Body:', JSON.stringify(relevantBody));
    }
  }
  
  // Capture response - simplified
  const originalSend = res.send;
  res.send = function(body) {
    console.log(`\n----- RESPONSE [${reqId}] -----`);
    
    // For responses, only log a summary based on the endpoint type
    try {
      let responseToLog;
      
      if (typeof body === 'string' && (body.startsWith('{') || body.startsWith('['))) {
        const jsonBody = JSON.parse(body);
        
        // Create a simplified response summary
        if (Array.isArray(jsonBody)) {
          responseToLog = `Array with ${jsonBody.length} items`;
        } else if (typeof jsonBody === 'object') {
          const summary = {};
          
          // Status info is always useful
          if (jsonBody.status) summary.status = jsonBody.status;
          if (jsonBody.success !== undefined) summary.success = jsonBody.success;
          if (jsonBody.error) summary.error = jsonBody.error;
          
          // Task ID for async operations
          if (jsonBody.taskId) summary.taskId = jsonBody.taskId;
          
          // For vehicle data, just show key identifiers
          if (jsonBody.vehicleId) summary.vehicleId = jsonBody.vehicleId;
          if (jsonBody.id) summary.id = jsonBody.id;
          
          // For video operations, show video URL status
          if (jsonBody.videoUrl) summary.videoUrl = '(URL available)';
          
          // For collections, just show count
          if (jsonBody.content && Array.isArray(jsonBody.content)) {
            summary.items = jsonBody.content.length;
          }
          
          responseToLog = JSON.stringify(summary);
        } else {
          responseToLog = JSON.stringify(jsonBody);
        }
      } else if (typeof body === 'string') {
        responseToLog = body.length > 100 ? body.substring(0, 100) + '...' : body;
      } else {
        responseToLog = 'Non-string response';
      }
      
      console.log(responseToLog);
    } catch (e) {
      console.log('Response: (unable to parse)');
    }
    
    return originalSend.apply(res, arguments);
  };
  
  next();
});

// Authentication endpoint
app.post('/auth/token', async (req, res) => {
  try {
    logger.info('Auth', 'Processing authentication request');
    
    const response = await axios({
      method: 'post',
      url: config.authApiUrl,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams(req.body)
    });
    
    // Log response with token security
    logger.info('Auth', 'Authentication successful', {
      status: response.status,
      access_token: response.data.access_token ? '[TOKEN_HIDDEN]' : undefined,
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
      scope: response.data.scope
    });
    
    res.json(response.data);
  } catch (error) {
    return handleApiError(error, res, 'Auth token');
  }
});

// Vehicle listing endpoint
app.get('/vehicles', requireAuth, async (req, res) => {
  try {
    const { page = 0, size = 20 } = req.query;
    logger.info('Vehicles', `Listing vehicles (page=${page}, size=${size}, country=${req.country})`);

    const response = await vehicleService.listVehicles({
      authToken: req.authToken,
      page,
      size,
      country: req.country,
      vehicleType: "USED",
      sort:"modificationDate%3Bdesc",
      logPrefix: 'VehicleListing'
    });
    
    logger.info('Vehicles', 'Vehicle listing retrieved', {
      totalVehicles: response.totalElements,
      totalPages: response.totalPages,
      size: response.size,
      vehicleCount: response.vehicles.length || 0
    });
    
    res.json(response);
  } catch (error) {
    return handleApiError(error, res, 'Vehicle listing');
  }
});

// Get single vehicle endpoint
app.get('/vehicle/:vehicleId', requireAuth, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    
    logger.info('Vehicle', `Fetching vehicle details (vehicleId=${vehicleId}, country=${req.country})`);
    
    const response = await vehicleService.getVehicleDetails({
      vehicleId,
      authToken: req.authToken,
      country: req.country,
      logPrefix: 'SingleVehicle'
    });
    
    logger.info('Vehicle', `Retrieved vehicle: ${response.brand} ${response.model}`, {
      vehicleId: response.id,
      brand: response.brand,
      model: response.model
    });
    
    res.json(response);
  } catch (error) {
    return handleApiError(error, res, 'Single vehicle');
  }
});

// Get vehicle gallery images
app.get('/vehicle/:vehicleId/images/gallery', requireAuth, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    
    // Use debug level instead of info to reduce log verbosity for frequent image requests
    logger.debug('Gallery', `Fetching vehicle images (vehicleId=${vehicleId}, country=${req.country})`);
    
    const response = await vehicleService.getVehicleImages({
      vehicleId,
      authToken: req.authToken,
      country: req.country,
      logPrefix: 'GalleryImages',
      logLevel: 'debug' // Signal to use debug level in the service too
    });
    
    // Only log at info level if there are no images (potential issue)
    if (!Array.isArray(response) || response.length === 0) {
      logger.info('Gallery', 'No images found for vehicle', { vehicleId });
    } else {
      logger.debug('Gallery', 'Retrieved vehicle images', {
        vehicleId,
        imageCount: response.length
      });
    }
    
    res.json(response);
  } catch (error) {
    // Still log errors at error level
    return handleApiError(error, res, 'Gallery images');
  }
});

// Upload image to vehicle gallery
app.post('/vehicle/:vehicleId/images/gallery/upload', upload.single('file'), async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const authHeader = req.headers.authorization;
    const country = req.query.country || 'it'; // Default to Italy if not specified
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    if (!req.file) {
      console.warn('\n----- UPLOAD ERROR: No file provided -----');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const fileSize = req.file.size;
    const fileName = req.file.originalname;
    
    console.log(`\n----- API REQUEST: Image upload (vehicleId=${vehicleId}, country=${country}) -----`);
    console.log(JSON.stringify({
      fileName: fileName,
      fileSize: `${(fileSize / 1024).toFixed(2)} KB`,
      mimeType: req.file.mimetype
    }, null, 2));
    
    // Create form data for the file upload
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), {
      filename: fileName,
      contentType: req.file.mimetype
    });
    
    // Use formData's getHeaders() to get proper headers including boundary
    const formHeaders = formData.getHeaders();
    
    const response = await axios({
      method: 'post',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}/images/gallery/upload`,
      headers: {
        ...formHeaders,
        'Authorization': authHeader,
        'Accept': '*/*'
      },
      data: formData,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    console.log('\n----- API RESPONSE: Image upload -----');
    console.log(JSON.stringify({
      status: response.status,
      response: typeof response.data === 'object' ? response.data : 'Raw response'
    }, null, 2));
    
    // Clean up - remove the temporary file
    fs.unlink(filePath, (err) => {
      if (err) console.error(`\n----- FILE ERROR: Failed to delete temporary file: ${filePath} -----`);
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('\n----- API ERROR: Image upload -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    // Clean up temp file even if upload fails
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error(`\n----- FILE ERROR: Failed to delete temporary file: ${req.file.path} -----`);
      });
    }
    
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Delete image from vehicle gallery
app.delete('/vehicle/:vehicleId/images/gallery/:imageId', async (req, res) => {
  try {
    const { vehicleId, imageId } = req.params;
    const authHeader = req.headers.authorization;
    const country = req.query.country || 'it'; // Default to Italy if not specified
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`\n----- API REQUEST: Image delete (vehicleId=${vehicleId}, imageId=${imageId}, country=${country}) -----`);
    const response = await axios({
      method: 'delete',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}/images/gallery/${imageId}`,
      headers: {
        'Authorization': authHeader,
        'Accept': '*/*'
      }
    });
    
    console.log('\n----- API RESPONSE: Image delete -----');
    console.log(JSON.stringify({
      status: response.status,
      statusText: response.statusText
    }, null, 2));
    
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error('\n----- API ERROR: Image delete -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Helper functions can be added here if needed

// Generate video for vehicle using Runway ML API
app.post('/vehicle/:vehicleId/generate-video', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const authHeader = req.headers.authorization;
    const country = req.query.country || 'it'; // Default to Italy if not specified
    const { prompt, style, duration, ratio } = req.body; // Optional parameters for video generation
    
    if (!authHeader) {
      logger.error('Auth', 'Missing authorization header for video generation');
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    if (!process.env.RUNWAY_API_KEY) {
      logger.error('Runway', 'API key not configured');
      return res.status(500).json({ error: 'Runway API key not configured' });
    }
    
    logger.info('VideoGeneration', `Starting for vehicle ${vehicleId}`, {
      country,
      style: style || 'cinematic',
      duration: duration,
      ratio: ratio
    });
    
    // Step 1: Get vehicle details using the vehicle service
    logger.info('VideoGeneration', 'Fetching vehicle details', { vehicleId, country });
    const vehicleData = await vehicleService.getVehicleDetails({
      vehicleId,
      authToken: authHeader,
      country,
      logPrefix: 'Generate'
    });
    
    logger.info('VideoGeneration', `Vehicle identified: ${vehicleData.brand} ${vehicleData.model}`, {
      brand: vehicleData.brand,
      model: vehicleData.model,
      year: vehicleData.year,
      color: vehicleData.exteriorColorName
    });
    
    // Step 2: Get vehicle images using the vehicle service
    logger.info('VideoGeneration', 'Fetching vehicle gallery images', { vehicleId });
    const images = await vehicleService.getVehicleImages({
      vehicleId,
      authToken: authHeader,
      country,
      logPrefix: 'Generate'
    });
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      logger.error('VideoGeneration', 'No images available for this vehicle', { vehicleId });
      return res.status(400).json({ error: 'No images available for this vehicle' });
    }
    
    logger.info('VideoGeneration', `Found ${images.length} images`, {
      vehicleId,
      imageCount: images.length
    });
    
    // Create a new task in the task service with video options
    const taskId = taskService.createVideoTask(vehicleId, vehicleData, {
      duration, 
      ratio, 
      style
    });
    
    // Capture what we need from the request before starting the background task
    const requestAuth = authHeader;
    const requestCountry = country;
    const requestProtocol = req.protocol;
    const requestHost = req.get('host');
    // Create a local copy of vehicleId for this task to avoid closure issues
    const taskVehicleId = vehicleId;
    
    // Start the video generation process in the background
    (async () => {
      try {
        // Step 4: Use the first image for video generation
        const selectedImage = images[0];
        logger.runway('Setup', `Selected primary image`, {
          imageUrl: selectedImage.url.substring(0, 60) + '...',
          totalImages: images.length
        }, taskId);
        
        // Update task status data
        taskService.updateTask(taskId, { imageUrl: selectedImage.url });
        
        // Step 5: Prepare data for Runway API
        // Build a prompt based on vehicle details if none provided
        const defaultPrompt = `A professional, high-quality video showcasing a ${vehicleData.year} ${vehicleData.brand} ${vehicleData.model} in ${vehicleData.exteriorColorName || 'its color'}. Show the car from different angles, highlighting its features.`;
        const videoPrompt = prompt || defaultPrompt;
        
        logger.runway('Setup', `Preparing video generation request`, {
          prompt: videoPrompt.substring(0, 100) + (videoPrompt.length > 100 ? '...' : ''),
          style: style || 'cinematic',
          duration: duration,
          ratio: ratio
        }, taskId);
        
        // Check if Runway service is available
        if (!runwayService.isSDKAvailable()) {
          logger.error('Runway', 'SDK not available', null, taskId);
          throw new Error('Runway SDK is not available. Make sure the API key is set and the SDK is properly installed.');
        }
        
        try {
          // Use the direct image URL
          const imageUrl = selectedImage.url;
          
          // Prepare request payload with new parameters
          const payload = {
            promptText: videoPrompt,
            promptImage: images.length > 1 ? images.slice(0, 2).map(img => img.url) : imageUrl,
            model: 'gen3a_turbo',
            duration: duration !== undefined ? duration : 5, // Use provided duration or default to 5 seconds
            ratio: ratio, // Add ratio parameter if provided
            parameters: {
              style: style || 'cinematic'
            },
            taskId: taskId // Include our task ID for logging purposes in the service
          };
          
          // Remove undefined properties
          Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
              delete payload[key];
            }
          });
          
          // Make the API call via the service
          const taskResponse = await runwayService.createImageToVideoTask(payload);
          
          // Extract task ID from response
          const runwayTaskId = taskResponse.taskId || taskResponse.id;
          
          // Store the runway task ID immediately in our task object
          taskService.updateTask(taskId, { 
            runwayTaskId,
            status: 'processing_runway'
          });
          
          // Poll for task completion
          let taskCompleted = false;
          let maxAttempts = 60; // 60 attempts (10 minutes at 10 second intervals)
          let attempts = 0;
          
          logger.runway('Polling', `Will poll Runway task ${runwayTaskId} every 10s`, {
            maxAttempts: maxAttempts,
            interval: '10 seconds'
          }, taskId);
          
          const startTime = new Date();
          
          while (!taskCompleted && attempts < maxAttempts) {
            // Wrap in try/catch to handle potential errors during status check
            try {
              // Only log detailed polling info every 3rd attempt to reduce noise
              if (attempts % 3 === 0) {
                logger.runway('Polling', `Attempt ${attempts + 1}/${maxAttempts}`, {
                  elapsedSeconds: Math.round((new Date() - startTime)/1000)
                }, taskId);
              }
              
              // Get task status via service
              const taskStatus = await runwayService.getTaskStatus(runwayTaskId, taskId);
              
              // Case-insensitive status comparison for better reliability
              const status = taskStatus && taskStatus.status ? taskStatus.status.toUpperCase() : 'UNKNOWN';
              attempts++;
              
              // Update our task object with the current status
              taskService.updateTask(taskId, {
                runwayStatus: status,
                lastChecked: new Date().toISOString()
              });
              
              if (status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'COMPLETED') {
                taskCompleted = true;
                const totalSeconds = Math.round((new Date() - startTime)/1000);
                
                logger.runway('Complete', `Task completed successfully after ${totalSeconds}s`, {
                  attempts: attempts,
                  outputType: typeof taskStatus.output
                }, taskId);
                
                // Handle different output formats
                let videoUrl;
                let outputFormat = 'unknown';
                
                if (Array.isArray(taskStatus.output) && taskStatus.output.length > 0) {
                  videoUrl = taskStatus.output[0];
                  outputFormat = 'array[0]';
                } else if (taskStatus.output?.urls?.mp4) {
                  videoUrl = taskStatus.output.urls.mp4;
                  outputFormat = 'urls.mp4';
                } else if (taskStatus.output?.mp4) {
                  videoUrl = taskStatus.output.mp4;
                  outputFormat = 'mp4';
                } else if (taskStatus.output?.video) {
                  videoUrl = taskStatus.output.video;
                  outputFormat = 'video';
                } else if (taskStatus.output?.url) {
                  videoUrl = taskStatus.output.url;
                  outputFormat = 'url';
                } else if (typeof taskStatus.output === 'string') {
                  videoUrl = taskStatus.output;
                  outputFormat = 'string';
                } else {
                  logger.error('Runway', 'Cannot extract URL from output', {
                    output: JSON.stringify(taskStatus.output).substring(0, 200)
                  }, taskId);
                  throw new Error('Video URL not found in completed task');
                }
                
                logger.runway('Complete', `Video URL retrieved (format: ${outputFormat})`, {
                  urlPreview: videoUrl.substring(0, 60) + '...'
                }, taskId);
                
                // Declare videoUrl in wider scope so it's available later
                if (!videoUrl) {
                  throw new Error('Video URL not found in completed task');
                }
                
                // Store videoUrl in task data so it's accessible outside this block
                taskService.updateTask(taskId, { 
                  tempVideoUrl: videoUrl 
                });
                
              } else if (status === 'FAILED' || status === 'ERROR') {
                logger.error('Runway', `Task failed: ${taskStatus.error || 'Unknown error'}`, {
                  errorDetails: taskStatus.error_details ? JSON.stringify(taskStatus.error_details).substring(0, 200) : 'None provided'
                }, taskId);
                throw new Error(`Task failed: ${taskStatus.error || 'Unknown error'}`);
              } else {
                // Task is still processing - we'll log less frequently
                await new Promise(resolve => setTimeout(resolve, 10000));
              }
            } catch (pollError) {
              logger.warn('Runway', `Error during status polling: ${pollError.message}`, null, taskId);
              
              // Continue polling despite error
              logger.runway('Polling', `Will retry in 10 seconds`, { 
                attempt: attempts + 1,
                maxAttempts: maxAttempts
              }, taskId);
              await new Promise(resolve => setTimeout(resolve, 10000));
              attempts++;
            }
          }
          
          if (!taskCompleted) {
            const totalSeconds = Math.round((new Date() - startTime)/1000);
            logger.error('Runway', `Task timed out after ${totalSeconds}s`, { attempts }, taskId);
            throw new Error(`Task timed out after ${attempts} polling attempts (${totalSeconds}s)`);
          }
          
          // Get the video URL from the task data and shorten it
          const videoTask = taskService.getTask(taskId);
          if (!videoTask || !videoTask.tempVideoUrl) {
            throw new Error('Video URL not available in task data');
          }
          
          // Shorten the video URL using the URL shortener service 
          logger.info('URLShortener', `Shortening video URL`, null, taskId);
          const shortUrl = await urlShortenerService.shortenUrl(videoTask.tempVideoUrl, { logPrefix: 'URLShortener', taskId });
          
          // Update task with video URL and completion status
          const completionTime = new Date();
          const completedAt = completionTime.toISOString();
          
          // Get the task data to calculate processing time
          const taskData = taskService.getTask(taskId);
          const startTimeStr = taskData.createdAt;
          const taskStartTime = new Date(startTimeStr);
          
          // Update task with completed info
          taskService.updateTask(taskId, {
            status: 'completed',
            videoUrl: shortUrl,
            originalVideoUrl: videoTask.tempVideoUrl,
            completedAt
          });
          const totalProcessingSeconds = Math.round((completionTime - taskStartTime)/1000);
          
          logger.info('VideoGeneration', `Completed successfully (${totalProcessingSeconds}s)`, {
            vehicleId: taskVehicleId,
            videoUrl: shortUrl,
            processingTime: `${totalProcessingSeconds}s`
          }, taskId);
          
          // Automatically update the vehicle videoUrl field with the shortened URL
          try {
            logger.info('VehicleUpdate', `Updating vehicle with video URL`, {
              vehicleId: taskVehicleId,
              field: 'videoUrl'
            }, taskId);
            
            // Use the vehicle service to update the field
            await vehicleService.updateVehicleField({
              vehicleId: taskVehicleId,
              field: 'videoUrl',
              value: shortUrl,
              authToken: requestAuth, 
              apiBaseUrl: `${requestProtocol}://${requestHost}`,
              country: requestCountry,
              logPrefix: 'VehicleUpdate'
            });
            
            // Update the task data to indicate vehicle was updated
            taskService.updateTask(taskId, {
              vehicleUpdated: true,
              updateTime: new Date().toISOString()
            });
            
            logger.info('VehicleUpdate', 'Successfully updated vehicle with new video URL', {
              vehicleId: taskVehicleId
            }, taskId);
          } catch (updateError) {
            logger.error('VehicleUpdate', `Failed to update vehicle videoUrl: ${updateError.message}`, {
              vehicleId: taskVehicleId
            }, taskId);
            // The video is still generated successfully even if update fails
          }
          
        } catch (error) {
          logger.error('Runway', `API error: ${error.message}`, {
            errorType: error.name,
            stack: error.stack?.substring(0, 200)
          }, taskId);
          
          // Additional detailed error logging
          if (error.response) {
            // The request was made and the server responded with an error status
            logger.error('Runway', `API response error`, {
              status: error.response.status,
              headers: JSON.stringify(error.response.headers).substring(0, 200),
              data: JSON.stringify(error.response.data).substring(0, 200)
            }, taskId);
          }
          
          // Re-throw the error to be caught by the outer try/catch
          throw error;
        }
      } catch (error) {
        logger.error('VideoGeneration', `Process failed: ${error.message}`, null, taskId);
        
        // Get the task data for logging
        const task = taskService.getTask(taskId);
        const startTimeStr = task?.createdAt;
        
        // Update task with failure info
        taskService.updateTask(taskId, {
          status: 'failed',
          error: error.message
        });
        
        if (startTimeStr) {
          const failedDurationSecs = Math.round((new Date() - new Date(startTimeStr))/1000);
          logger.info('VideoGeneration', `Process terminated with error after ${failedDurationSecs}s`, {
            vehicleId: taskVehicleId
          }, taskId);
        }
      }
    })();
    
    // Return immediately with the task ID for the client to poll
    res.json({
      taskId,
      vehicleId,
      status: 'processing',
      message: 'Video generation started. Use the /vehicle/video/:taskId endpoint to check status.'
    });
  } catch (error) {
    logger.error('VideoGeneration', `Request handler error: ${error.message}`, {
      status: error.response?.status || 'Unknown',
      vehicleId: req.params.vehicleId,
      responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : 'N/A'
    });
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Get video generation task status
app.get('/vehicle/video/:taskId', (req, res) => {
  const { taskId } = req.params;
  
  const taskStatus = taskService.getTaskStatus(taskId);
  
  if (!taskStatus) {
    return res.status(404).json({ error: 'Video generation task not found' });
  }
  
  // Return task status
  res.json(taskStatus);
});

// Get video generation task history
app.get('/vehicle/video-history', requireAuth, (req, res) => {
  try {
    const { vehicleId, status, month, limit } = req.query;
    
    logger.info('TaskHistory', `Fetching video task history`, {
      filters: { vehicleId, status, month, limit }
    });
    
    const options = {};
    if (vehicleId) options.vehicleId = vehicleId;
    if (status) options.status = status;
    if (month) options.month = month;
    if (limit) options.limit = parseInt(limit, 10);
    
    const history = taskService.getTaskHistory(options);
    
    logger.info('TaskHistory', `Retrieved ${history.length} history records`);
    
    res.json({
      count: history.length,
      history
    });
  } catch (error) {
    logger.error('TaskHistory', `Error fetching history: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch task history' });
  }
});

// NOTE: The attach-video endpoint has been removed as it was legacy code
// The proper way to update vehicle's video URL is through the /vehicle/:vehicleId/update-field endpoint

// Update vehicle field endpoint
app.put('/vehicle/:vehicleId/update-field', requireAuth, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { field, value } = req.body;
    
    if (!field || value === undefined) {
      logger.warn('UpdateField', 'Missing required fields');
      return res.status(400).json({ error: 'Both field and value must be provided' });
    }

    logger.info('UpdateField', `Updating vehicle field (vehicleId=${vehicleId}, field=${field})`, {
      field,
      value,
      country: req.country
    });
    
    // Use the vehicle service to update the field
    const updateResponse = await vehicleService.updateVehicleField({
      vehicleId,
      field,
      value,
      authToken: req.authToken,
      country: req.country,
      logPrefix: 'UpdateField'
    });
    
    logger.info('UpdateField', 'Vehicle field updated', {
      vehicleId: updateResponse.vehicleId,
      updatedField: updateResponse.updatedField,
      oldValue: updateResponse.oldValue,
      newValue: updateResponse.newValue
    });
    
    res.json(updateResponse);
  } catch (error) {
    return handleApiError(error, res, 'Update vehicle field');
  }
});

// Only start the server if we're not in a test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    const environment = process.env.NODE_ENV || 'development';
    const runwayConfigured = process.env.RUNWAY_API_KEY ? 'Configured ✓' : 'Not configured ✗';
    const runwaySDKAvailable = runwayService.isSDKAvailable() ? 'Available ✓' : 'Unavailable ✗';
    
    logger.info('Server', 'MotorK AI Videos POC Server started', {
      port: PORT,
      environment,
      runway: {
        api: runwayConfigured,
        sdk: runwaySDKAvailable
      }
    });
    
    console.log('=================================');
    console.log(`MotorK AI Videos POC Server`);
    console.log(`Running on port: ${PORT} | Environment: ${environment}`);
    console.log(`Runway API: ${runwayConfigured}`);
    console.log(`Runway SDK: ${runwaySDKAvailable}`);
    console.log('=================================');
  });
}

// N8N Proxy endpoint
app.post('/n8n-proxy', async (req, res) => {
  try {
    const { sessionId, message, page, lastResponse } = req.body;
    const authHeader = req.headers.authorization;
    
    // Validate required fields
    if (!sessionId || !message) {
      logger.warn('N8NProxy', 'Missing required fields');
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    logger.info('N8NProxy', `Processing request with sessionId: ${sessionId}`, {
      hasLastResponse: lastResponse ? 'Yes' : 'No'
    });
    
    // Use the n8n service to forward the request
    const response = await n8nService.forwardToN8n({
      sessionId,
      message,
      page,
      lastResponse,
      authToken: authHeader, // Forward the authorization header
      logPrefix: 'N8NProxy'
    });
    
    // Return the n8n response to the client with proper content type
    // If response is already an object, send as JSON
    // If it's a string, determine if it's JSON string or plain text
    if (typeof response === 'object') {
      res.json(response);
    } else if (typeof response === 'string') {
      // Check if the string is JSON
      try {
        const jsonData = JSON.parse(response);
        // It's a valid JSON string, so set content type and send raw to preserve exact format
        res.set('Content-Type', 'application/json');
        res.send(response);
      } catch (e) {
        // Not JSON, send as plain text
        res.send(response);
      }
    } else {
      // For any other type, convert to JSON
      res.json(response);
    }
  } catch (error) {
    return handleApiError(error, res, 'N8N Proxy');
  }
});

// Export the app for testing
module.exports = app;
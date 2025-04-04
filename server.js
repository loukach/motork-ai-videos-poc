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
    
    logger.info('Gallery', `Fetching vehicle images (vehicleId=${vehicleId}, country=${req.country})`);
    
    const response = await vehicleService.getVehicleImages({
      vehicleId,
      authToken: req.authToken,
      country: req.country,
      logPrefix: 'GalleryImages'
    });
    
    logger.info('Gallery', 'Retrieved vehicle images', {
      imageCount: Array.isArray(response) ? response.length : 'N/A'
    });
    
    res.json(response);
  } catch (error) {
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
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    if (!process.env.RUNWAY_API_KEY) {
      console.error('\n----- API ERROR: Runway API key not configured -----');
      return res.status(500).json({ error: 'Runway API key not configured' });
    }
    
    console.log(`\n----- PROCESS: Starting video generation for vehicle ${vehicleId} -----`);
    
    // Step 1: Get vehicle details using the vehicle service
    console.log(`\n----- PROCESS: Fetching vehicle details -----`);
    const vehicleData = await vehicleService.getVehicleDetails({
      vehicleId,
      authToken: authHeader,
      country,
      logPrefix: 'Generate'
    });
    
    console.log(`\n----- VEHICLE INFO: ${vehicleData.brand} ${vehicleData.model} -----`);
    
    // Step 2: Get vehicle images using the vehicle service
    console.log(`\n----- PROCESS: Fetching vehicle gallery images -----`);
    const images = await vehicleService.getVehicleImages({
      vehicleId,
      authToken: authHeader,
      country,
      logPrefix: 'Generate'
    });
    if (!images || !Array.isArray(images) || images.length === 0) {
      console.error('\n----- ERROR: No images available for this vehicle -----');
      return res.status(400).json({ error: 'No images available for this vehicle' });
    }
    
    console.log(`\n----- IMAGES: Found ${images.length} images -----`);
    
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
        console.log(`Selected image with URL: ${selectedImage.url}`);
        
        // Update task status data
        taskService.updateTask(taskId, { imageUrl: selectedImage.url });
        
        // Step 5: Prepare data for Runway API
        // Build a prompt based on vehicle details if none provided
        const defaultPrompt = `A professional, high-quality video showcasing a ${vehicleData.year} ${vehicleData.brand} ${vehicleData.model} in ${vehicleData.exteriorColorName || 'its color'}. Show the car from different angles, highlighting its features.`;
        const videoPrompt = prompt || defaultPrompt;
        
        console.log(`\n----- RUNWAY REQUEST: Starting video generation -----`);
        console.log(`Prompt: ${videoPrompt}`);
        
        // Step 6: Call Runway API to generate video
        console.log(`Preparing to generate video with prompt: "${videoPrompt}"`);
        console.log(`Style: ${style || 'cinematic'} (default: cinematic)`);
        
        // Log new parameters if provided
        if (duration !== undefined) {
          console.log(`Duration: ${duration} seconds`);
        }
        if (ratio !== undefined) {
          console.log(`Ratio: ${ratio}`);
        }
        
        // Submit generation request to Runway
        let videoUrl, runwayTaskId;
        
        // Check if Runway service is available
        if (!runwayService.isSDKAvailable()) {
          console.log('\n----- RUNWAY SDK ERROR: SDK not available -----');
          throw new Error('Runway SDK is not available. Make sure the API key is set and the SDK is properly installed.');
        }
        
        try {
          console.log('\n----- RUNWAY API: Creating video generation task -----');
          
          // Use the direct image URL
          const imageUrl = selectedImage.url;
          console.log(`Using image URL: ${imageUrl}`);
          
          // Initialize the generation task 
          console.log('Starting imageToVideo task...');
          
          // Prepare request payload with new parameters
          const payload = {
            promptText: videoPrompt,
            promptImage: images.length > 1 ? images.slice(0, 2).map(img => img.url) : imageUrl,
            model: 'gen3a_turbo',
            duration: duration !== undefined ? duration : 10, // Use provided duration or default to 10 seconds
            ratio: ratio, // Add ratio parameter if provided
            parameters: {
              style: style || 'cinematic'
            }
          };
          
          // Remove undefined properties
          Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
              delete payload[key];
            }
          });
          
          console.log(`Runway request: ${style || 'cinematic'} style, ${payload.duration}s duration${payload.ratio ? `, ${payload.ratio} ratio` : ''}`);
          console.log(`Using ${Array.isArray(payload.promptImage) ? payload.promptImage.length + ' images' : '1 image'} for video generation`);
          
          // Make the API call via the service
          const taskResponse = await runwayService.createImageToVideoTask(payload);
          
          // If we get here, the call succeeded
          console.log('Successfully sent request to Runway API');
          runwayTaskId = taskResponse.taskId || taskResponse.id;
          
          // Store the runway task ID immediately in our task object
          taskService.updateTask(taskId, { 
            runwayTaskId,
            status: 'processing_runway'
          });
          
          console.log(`Task created with ID: ${runwayTaskId}`);
          
          // Poll for task completion
          let taskCompleted = false;
          let maxAttempts = 60; // Increase to 60 attempts (10 minutes at 10 second intervals)
          let attempts = 0;
          
          console.log(`[Video][${taskId}] Polling Runway task ${runwayTaskId} (every 10s, max ${maxAttempts} attempts)`);
          const startTime = new Date();
          
          while (!taskCompleted && attempts < maxAttempts) {
            // Wrap in try/catch to handle potential errors during status check
            try {
              console.log(`[Video][${taskId}] Polling attempt ${attempts + 1}/${maxAttempts}, elapsed time: ${Math.round((new Date() - startTime)/1000)}s`);
              
              // Get task status via service instead of direct SDK access
              const taskStatus = await runwayService.getTaskStatus(runwayTaskId);
              
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
                console.log(`[Video][${taskId}] ✅ Task completed successfully after ${attempts} attempts (${totalSeconds}s)`);
                
                // Log the output format for debugging
                console.log(`[Video][${taskId}] Output format: ${typeof taskStatus.output} ${Array.isArray(taskStatus.output) ? 'array' : ''}`);
                if (typeof taskStatus.output === 'object' && !Array.isArray(taskStatus.output)) {
                  console.log(`[Video][${taskId}] Output keys: ${Object.keys(taskStatus.output).join(', ')}`);
                }
                
                // Handle different output formats
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
                  console.error(`[Video][${taskId}] ❌ Cannot extract URL from output:`, JSON.stringify(taskStatus.output));
                  throw new Error('Video URL not found in completed task');
                }
                
                console.log(`[Video][${taskId}] Video URL retrieved from '${outputFormat}' format: ${videoUrl.substring(0, 60)}...`);
              } else if (status === 'FAILED' || status === 'ERROR') {
                console.error(`[Video][${taskId}] ❌ Runway task failed: ${taskStatus.error || 'Unknown error'}`);
                if (taskStatus.error_details) {
                  console.error(`[Video][${taskId}] Error details:`, JSON.stringify(taskStatus.error_details));
                }
                throw new Error(`Task failed: ${taskStatus.error || 'Unknown error'}`);
              } else {
                // Task is still processing
                if (attempts % 3 === 0) { // Only log every 3rd check to reduce noise
                  console.log(`[Video][${taskId}] 🔄 Status: ${status} (attempt ${attempts}/${maxAttempts}, elapsed: ${Math.round((new Date() - startTime)/1000)}s)`);
                }
                // Wait 10 seconds before checking again
                await new Promise(resolve => setTimeout(resolve, 10000));
              }
            } catch (pollError) {
              console.error(`[Video][${taskId}] ⚠️ Error during status polling: ${pollError.message}`);
              
              // Continue polling despite error
              console.log(`[Video][${taskId}] Will retry polling in 10 seconds (attempt ${attempts + 1}/${maxAttempts})...`);
              await new Promise(resolve => setTimeout(resolve, 10000));
              attempts++;
            }
          }
          
          if (!taskCompleted) {
            const totalSeconds = Math.round((new Date() - startTime)/1000);
            console.error(`[Video][${taskId}] ⏱️ Task timed out after ${attempts} polling attempts (${totalSeconds}s)`);
            throw new Error(`Task timed out after ${attempts} polling attempts (${totalSeconds}s)`);
          }
        } catch (error) {
          console.error(`[Video][${taskId}] ❌ Runway API error: ${error.message}`);
          
          // Additional detailed error logging
          console.error(`[Video][${taskId}] Detailed error information:`);
          if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error(`[Video][${taskId}] Status: ${error.response.status}`);
            console.error(`[Video][${taskId}] Response headers:`, JSON.stringify(error.response.headers, null, 2));
            console.error(`[Video][${taskId}] Response data:`, JSON.stringify(error.response.data, null, 2));
          } else if (error.request) {
            // The request was made but no response was received
            console.error(`[Video][${taskId}] No response received from server`);
            console.error(`[Video][${taskId}] Request details:`, error.request);
          } else {
            // Something happened in setting up the request that triggered an Error
            console.error(`[Video][${taskId}] Error details:`, error.stack);
          }
          
          // Try to get the first image directly to check if it's accessible
          console.log(`[Video][${taskId}] Checking image accessibility...`);
          try {
            const checkImageResponse = await axios.head(selectedImage.url);
            console.log(`[Video][${taskId}] Image check result: HTTP ${checkImageResponse.status}`);
            console.log(`[Video][${taskId}] Image content type: ${checkImageResponse.headers['content-type']}`);
          } catch (imageCheckError) {
            console.error(`[Video][${taskId}] Failed to access image: ${imageCheckError.message}`);
          }
          
          // Re-throw the error to be caught by the outer try/catch
          throw error;
        }
        
        // Shorten the video URL using the URL shortener service
        const logPrefix = `Video][${taskId}`;
        const shortUrl = await urlShortenerService.shortenUrl(videoUrl, { logPrefix });

        // Update task with video URL and completion status
        const completionTime = new Date();
        const completedAt = completionTime.toISOString();
        
        // Get the task data to calculate processing time
        const task = taskService.getTask(taskId);
        const startTimeStr = task.createdAt;
        const startTime = new Date(startTimeStr);
        
        // Update task with completed info
        taskService.updateTask(taskId, {
          status: 'completed',
          videoUrl: shortUrl,
          originalVideoUrl: videoUrl,
          completedAt
        });
        const totalProcessingSeconds = Math.round((completionTime - startTime)/1000);
        
        console.log(`[Video][${taskId}] 🎬 Video generation completed successfully in ${totalProcessingSeconds}s total`);
        console.log(`[Video][${taskId}] Started: ${startTimeStr}, Completed: ${completionTime.toISOString()}`);
        console.log(`[Video][${taskId}] Vehicle: ${taskVehicleId}, Video URL: ${shortUrl}`);
        
        // Automatically update the vehicle videoUrl field with the shortened URL
        const vehicleUpdateLogPrefix = `VehicleUpdate][${taskId}`;
        let updateSuccess = false;
        let updateResponse;
        
        try {
          // Use the vehicle service to update the field
          updateResponse = await vehicleService.updateVehicleField({
            vehicleId: taskVehicleId,
            field: 'videoUrl',
            value: shortUrl,
            authToken: requestAuth, 
            apiBaseUrl: `${requestProtocol}://${requestHost}`,
            country: requestCountry,
            logPrefix: vehicleUpdateLogPrefix
          });
          
          // Update the task data to indicate vehicle was updated
          taskService.updateTask(taskId, {
            vehicleUpdated: true,
            updateTime: new Date().toISOString()
          });
          updateSuccess = true;
        } catch (updateError) {
          // The vehicle service handles retry internally
          console.error(`[VehicleUpdate][${taskId}] ⛔ Failed to update vehicle videoUrl: ${updateError.message}`);
          // The video is still generated successfully even if update fails
        }
        
        // Full process complete - log final status
        const fullProcessSeconds = Math.round((new Date() - new Date(startTimeStr))/1000);
        console.log(`[Process][${taskId}] ✨ Complete process took ${fullProcessSeconds}s - Vehicle: ${taskVehicleId}, Video: ${shortUrl}`);
        if (updateSuccess) {
          console.log(`[Process][${taskId}] ✅ Vehicle was successfully updated with the new video URL`);
        } else {
          console.log(`[Process][${taskId}] ⚠️ Video was generated but vehicle update failed`);
        }
      } catch (error) {
        console.error(`[Process][${taskId}] ❌ Video generation failed: ${error.message}`);
        
        // Get the task data for logging
        const task = taskService.getTask(taskId);
        const startTimeStr = task.createdAt;
        
        // Update task with failure info
        taskService.updateTask(taskId, {
          status: 'failed',
          error: error.message
        });
        if (startTimeStr) {
          const failedDurationSecs = Math.round((new Date() - new Date(startTimeStr))/1000);
          console.error(`[Process][${taskId}] ⏱️ Failed after ${failedDurationSecs}s`);
        }
        
        console.error(`[Process][${taskId}] ⏹️ Process terminated with error for vehicle ${taskVehicleId}`);
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
    console.error('\n----- ERROR: Video generation process -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
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

// Attach generated video to vehicle data
app.post('/vehicle/:vehicleId/attach-video', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { videoUrl, taskId } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    // Validate inputs
    if (!videoUrl && !taskId) {
      return res.status(400).json({ error: 'Either videoUrl or taskId must be provided' });
    }
    
    let finalVideoUrl = videoUrl;
    
    // If taskId is provided, get the video URL from the task
    if (taskId) {
      if (!videoTasks.has(taskId)) {
        return res.status(404).json({ error: 'Video generation task not found' });
      }
      
      const task = videoTasks.get(taskId);
      
      if (task.status !== 'completed') {
        return res.status(400).json({ 
          error: 'Video generation not completed yet',
          status: task.status
        });
      }
      
      finalVideoUrl = task.videoUrl;
    }
    
    // In a real implementation, you would update the vehicle data in your database
    // For this example, we'll just return a success message
    console.log(`\n----- PROCESS: Attaching video to vehicle ${vehicleId} -----`);
    console.log(`Video URL: ${finalVideoUrl}`);
    
    // If we're using a task, include both URLs in the response
    const responseData = {
      success: true,
      vehicleId,
      videoUrl: finalVideoUrl,
      message: 'Video attached to vehicle successfully'
    };
    
    // Include original URL if available from the task
    if (taskId && videoTasks.has(taskId)) {
      const task = videoTasks.get(taskId);
      if (task.originalVideoUrl) {
        responseData.originalVideoUrl = task.originalVideoUrl;
      }
    }
    
    res.json(responseData);
  } catch (error) {
    console.error('\n----- ERROR: Attaching video to vehicle -----');
    console.error(`Message: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
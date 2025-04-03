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

const app = express();
const PORT = process.env.PORT || 3000;

// Runway API Configuration
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;

// In-memory storage for video generation tasks
const videoTasks = new Map();

// Task cleanup function - removes tasks older than 24 hours
const cleanupOldTasks = () => {
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  let removedCount = 0;
  
  for (const [taskId, task] of videoTasks.entries()) {
    const createdAt = new Date(task.createdAt);
    if (now - createdAt > oneDayMs) {
      videoTasks.delete(taskId);
      removedCount++;
    }
  }
  
  if (removedCount > 0) {
    console.log(`Cleanup: Removed ${removedCount} tasks older than 24 hours`);
  }
};

// Run cleanup every hour
setInterval(cleanupOldTasks, 60 * 60 * 1000);

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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
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
    console.log('\n----- API REQUEST: Auth token -----');
    const response = await axios({
      method: 'post',
      url: 'https://auth.motork.io/realms/prod/protocol/openid-connect/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams(req.body)
    });
    
    // Log response with token security
    console.log('\n----- API RESPONSE: Auth token -----');
    console.log(JSON.stringify({
      status: response.status,
      access_token: response.data.access_token ? '[TOKEN_HIDDEN]' : undefined,
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
      scope: response.data.scope
    }, null, 2));
    
    res.json(response.data);
  } catch (error) {
    console.error('\n----- API ERROR: Auth token -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Vehicle listing endpoint
app.get('/vehicles', async (req, res) => {
  try {
    const { page = 0, size = 10 } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`\n----- API REQUEST: Vehicle listing (page=${page}, size=${size}) -----`);
    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/it/vehicle?page=${page}&size=${size}`,
      headers: {
        'Authorization': authHeader
      }
    });
    
    console.log('\n----- API RESPONSE: Vehicle listing -----');
    console.log(JSON.stringify({
      status: response.status,
      totalElements: response.data.totalElements,
      totalPages: response.data.totalPages,
      size: response.data.size,
      vehicleCount: response.data.content?.length || 0
    }, null, 2));
    
    res.json(response.data);
  } catch (error) {
    console.error('\n----- API ERROR: Vehicle listing -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Get single vehicle endpoint
app.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const authHeader = req.headers.authorization;
    const country = req.query.country || 'it'; // Default to Italy if not specified
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`\n----- API REQUEST: Single vehicle (vehicleId=${vehicleId}, country=${country}) -----`);
    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });
    
    console.log('\n----- API RESPONSE: Single vehicle -----');
    console.log(JSON.stringify({
      status: response.status,
      vehicleId: response.data.id,
      brand: response.data.brand,
      model: response.data.model
    }, null, 2));
    
    res.json(response.data);
  } catch (error) {
    console.error('\n----- API ERROR: Single vehicle -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Get vehicle gallery images
app.get('/vehicle/:vehicleId/images/gallery', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const authHeader = req.headers.authorization;
    const country = req.query.country || 'it'; // Default to Italy if not specified
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`\n----- API REQUEST: Gallery images (vehicleId=${vehicleId}, country=${country}) -----`);
    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}/images/gallery`,
      headers: {
        'Authorization': authHeader,
        'Accept': '*/*'
      }
    });
    
    console.log('\n----- API RESPONSE: Gallery images -----');
    console.log(JSON.stringify({
      status: response.status,
      imageCount: Array.isArray(response.data) ? response.data.length : 'N/A'
    }, null, 2));
    
    res.json(response.data);
  } catch (error) {
    console.error('\n----- API ERROR: Gallery images -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
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
    const { prompt, style } = req.body; // Optional parameters for video generation
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    if (!RUNWAY_API_KEY) {
      console.error('\n----- API ERROR: Runway API key not configured -----');
      return res.status(500).json({ error: 'Runway API key not configured' });
    }
    
    console.log(`\n----- PROCESS: Starting video generation for vehicle ${vehicleId} -----`);
    
    // Step 1: Get vehicle details
    console.log(`\n----- API REQUEST: Fetching vehicle details -----`);
    const vehicleResponse = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });
    
    const vehicleData = vehicleResponse.data;
    console.log(`\n----- VEHICLE INFO: ${vehicleData.brand} ${vehicleData.model} -----`);
    
    // Step 2: Get vehicle images
    console.log(`\n----- API REQUEST: Fetching vehicle gallery images -----`);
    const imagesResponse = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}/images/gallery`,
      headers: {
        'Authorization': authHeader,
        'Accept': '*/*'
      }
    });
    
    const images = imagesResponse.data;
    if (!images || !Array.isArray(images) || images.length === 0) {
      console.error('\n----- ERROR: No images available for this vehicle -----');
      return res.status(400).json({ error: 'No images available for this vehicle' });
    }
    
    console.log(`\n----- IMAGES: Found ${images.length} images -----`);
    
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
        videoTasks.get(taskId).imageUrl = selectedImage.url;
        
        // Step 5: Prepare data for Runway API
        // Build a prompt based on vehicle details if none provided
        const defaultPrompt = `A professional, high-quality video showcasing a ${vehicleData.year} ${vehicleData.brand} ${vehicleData.model} in ${vehicleData.exteriorColorName || 'its color'}. Show the car from different angles, highlighting its features.`;
        const videoPrompt = prompt || defaultPrompt;
        
        console.log(`\n----- RUNWAY REQUEST: Starting video generation -----`);
        console.log(`Prompt: ${videoPrompt}`);
        
        // Step 6: Call Runway API to generate video
        console.log(`Preparing to generate video with prompt: "${videoPrompt}"`);
        console.log(`Style: ${style || 'cinematic'} (default: cinematic)`);
        
        // Submit generation request to Runway
        let videoUrl, runwayTaskId;
        
        if (!runway) {
          console.log('\n----- RUNWAY SDK ERROR: SDK not available -----');
          throw new Error('Runway SDK is not available. Make sure the API key is set and the SDK is properly installed.');
        } else {
          try {
            // Real implementation with Runway SDK
            console.log('\n----- RUNWAY SDK: Using real implementation -----');
            
            // Use the direct image URL
            const imageUrl = selectedImage.url;
            console.log(`Using image URL: ${imageUrl}`);
            
            // Initialize the generation task using imageToVideo.create()
            console.log('Starting imageToVideo task...');
            
            // Prepare request payload
            const payload = {
              promptText: videoPrompt,
              promptImage: imageUrl,
              model: 'gen3a_turbo',
              duration: 5, // Duration in seconds
              parameters: {
                style: style || 'cinematic'
              }
            };
            console.log(`Runway request: ${style || 'cinematic'} style, ${payload.duration}s duration`);
            
            // Make the API call
            const taskResponse = await runway.imageToVideo.create(payload);
            
            // If we get here, the call succeeded
            console.log('Successfully sent request to Runway API');
            runwayTaskId = taskResponse.taskId || taskResponse.id;
            
            // Store the runway task ID immediately in our task object
            videoTasks.get(taskId).runwayTaskId = runwayTaskId;
            videoTasks.get(taskId).status = 'processing_runway';
            
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
                const taskStatus = await runway.tasks.retrieve(runwayTaskId);
                
                // Case-insensitive status comparison for better reliability
                const status = taskStatus && taskStatus.status ? taskStatus.status.toUpperCase() : 'UNKNOWN';
                attempts++;
                
                // Update our task object with the current status
                videoTasks.get(taskId).runwayStatus = status;
                videoTasks.get(taskId).lastChecked = new Date().toISOString();
                
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
        }
        
        // Shorten the video URL using is.gd
        console.log(`[Video][${taskId}] 🔗 Shortening video URL...`);
        let shortUrl = videoUrl;
        try {
          // URL encode the video URL
          const encodedUrl = encodeURIComponent(videoUrl);
          console.log(`[Video][${taskId}] Calling is.gd API...`);
          const shortenStartTime = new Date();
          
          const shortenResponse = await axios({
            method: 'get',
            url: `https://is.gd/create.php?format=json&url=${encodedUrl}`
          });
          
          const shortenTime = Math.round((new Date() - shortenStartTime));
          
          if (shortenResponse.data && shortenResponse.data.shorturl) {
            shortUrl = shortenResponse.data.shorturl;
            console.log(`[Video][${taskId}] ✅ URL shortened successfully in ${shortenTime}ms: ${shortUrl}`);
            console.log(`[Video][${taskId}] Original: ${videoUrl.substring(0, 30)}... → Shortened: ${shortUrl}`);
          } else {
            console.log(`[Video][${taskId}] ⚠️ URL shortener returned unexpected response (${shortenTime}ms), using original URL`);
            console.log(`[Video][${taskId}] Response:`, JSON.stringify(shortenResponse.data));
          }
        } catch (shortenError) {
          console.log(`[Video][${taskId}] ❌ URL shortening failed, using original URL: ${shortenError.message}`);
          if (shortenError.response) {
            console.log(`[Video][${taskId}] Response status: ${shortenError.response.status}`);
          }
          // Continue with the original URL if shortening fails
        }

        // Update task with video URL and completion status
        const completionTime = new Date();
        videoTasks.get(taskId).status = 'completed';
        videoTasks.get(taskId).videoUrl = shortUrl;
        videoTasks.get(taskId).originalVideoUrl = videoUrl;
        // runwayTaskId already stored earlier
        videoTasks.get(taskId).completedAt = completionTime.toISOString();
        
        // Calculate total processing time
        const startTimeStr = videoTasks.get(taskId).createdAt;
        const startTime = new Date(startTimeStr);
        const totalProcessingSeconds = Math.round((completionTime - startTime)/1000);
        
        console.log(`[Video][${taskId}] 🎬 Video generation completed successfully in ${totalProcessingSeconds}s total`);
        console.log(`[Video][${taskId}] Started: ${startTimeStr}, Completed: ${completionTime.toISOString()}`);
        console.log(`[Video][${taskId}] Vehicle: ${taskVehicleId}, Video URL: ${shortUrl}`);
        
        // Automatically update the vehicle videoUrl field with the shortened URL
        // Implement with retry logic
        let updateSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;
        
        console.log(`[VehicleUpdate][${taskId}] 🚗 Updating vehicle ${taskVehicleId} videoUrl field with short URL...`);
        console.log(`[VehicleUpdate][${taskId}] Field: videoUrl, Value: ${shortUrl}`);
        
        const updateStartTime = new Date();
        
        while (!updateSuccess && retryCount < maxRetries) {
          try {
            // Call the update-field endpoint using the captured request details
            console.log(`[VehicleUpdate][${taskId}] Attempt ${retryCount + 1}/${maxRetries}...`);
            const updateStartAttempt = new Date();
            
            const updateResponse = await axios({
              method: 'put',
              url: `${requestProtocol}://${requestHost}/vehicle/${taskVehicleId}/update-field`,
              headers: {
                'Authorization': requestAuth,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              data: {
                field: 'videoUrl',
                value: shortUrl
              }
            });
            
            const updateAttemptMs = Math.round(new Date() - updateStartAttempt);
            console.log(`[VehicleUpdate][${taskId}] ✅ Vehicle ${taskVehicleId} videoUrl updated successfully in ${updateAttemptMs}ms`);
            console.log(`[VehicleUpdate][${taskId}] Response status: ${updateResponse.status}`);
            
            // Update the task data to indicate vehicle was updated
            videoTasks.get(taskId).vehicleUpdated = true;
            videoTasks.get(taskId).updateTime = new Date().toISOString();
            updateSuccess = true;
          } catch (updateError) {
            retryCount++;
            const updateAttemptMs = Math.round(new Date() - updateStartTime);
            
            console.error(`[VehicleUpdate][${taskId}] ❌ Attempt ${retryCount}/${maxRetries} failed after ${updateAttemptMs}ms: ${updateError.message}`);
            
            if (updateError.response) {
              console.error(`[VehicleUpdate][${taskId}] Response status: ${updateError.response.status}`);
              if (updateError.response.data) {
                console.error(`[VehicleUpdate][${taskId}] Response data:`, JSON.stringify(updateError.response.data));
              }
            }
            
            if (retryCount < maxRetries) {
              // Wait before retrying (exponential backoff)
              const retryDelay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
              console.log(`[VehicleUpdate][${taskId}] Waiting ${retryDelay/1000}s before retry...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
              const totalUpdateTimeMs = Math.round(new Date() - updateStartTime);
              console.error(`[VehicleUpdate][${taskId}] ⛔ Failed to update vehicle videoUrl after ${maxRetries} attempts (${totalUpdateTimeMs}ms): ${updateError.message}`);
              // The video is still generated successfully even if update fails
            }
          }
        }
        
        const totalUpdateTimeMs = Math.round(new Date() - updateStartTime);
        console.log(`[VehicleUpdate][${taskId}] Update process completed in ${totalUpdateTimeMs}ms (success: ${updateSuccess})`);
        
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
        videoTasks.get(taskId).status = 'failed';
        videoTasks.get(taskId).error = error.message;
        
        // Log elapsed time for failed process
        const startTimeStr = videoTasks.get(taskId).createdAt;
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
  
  if (!videoTasks.has(taskId)) {
    return res.status(404).json({ error: 'Video generation task not found' });
  }
  
  const task = videoTasks.get(taskId);
  
  // Return task status
  res.json({
    taskId,
    vehicleId: task.vehicleId,
    status: task.status,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    videoUrl: task.status === 'completed' ? task.videoUrl : undefined,
    originalVideoUrl: task.status === 'completed' ? task.originalVideoUrl : undefined,
    runwayTaskId: task.runwayTaskId, // Include the Runway task ID
    vehicleUpdated: task.vehicleUpdated || false, // Include whether the vehicle was updated
    error: task.error
  });
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
app.put('/vehicle/:vehicleId/update-field', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { field, value } = req.body;
    const authHeader = req.headers.authorization;
    const country = req.query.country || 'it'; // Default to Italy if not specified
    
    if (!authHeader) {
      console.warn('\n----- AUTH ERROR: Missing authorization header -----');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    if (!field || value === undefined) {
      console.warn('\n----- REQUEST ERROR: Missing required fields -----');
      return res.status(400).json({ error: 'Both field and value must be provided' });
    }

    // Step 1: Get current vehicle data
    console.log(`\n----- API REQUEST: Fetching vehicle data (vehicleId=${vehicleId}, country=${country}) -----`);
    const vehicleResponse = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });
    
    const vehicleData = vehicleResponse.data;
    console.log('\n----- API RESPONSE: Vehicle data fetched -----');
    
    // Step 2: Update the specified field
    if (!(field in vehicleData)) {
      console.warn(`\n----- REQUEST ERROR: Field '${field}' not found in vehicle data -----`);
      return res.status(400).json({ error: `Field '${field}' not found in vehicle data` });
    }
    
    console.log(`\n----- UPDATE: Changing field '${field}' from '${vehicleData[field]}' to '${value}' -----`);
    vehicleData[field] = value;
    
    // Step 3: Send updated data back to the API
    console.log(`\n----- API REQUEST: Updating vehicle data (vehicleId=${vehicleId}, country=${country}) -----`);
    const updateResponse = await axios({
      method: 'put',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: vehicleData
    });
    
    console.log('\n----- API RESPONSE: Vehicle data updated -----');
    console.log(JSON.stringify({
      status: updateResponse.status,
      vehicleId: updateResponse.data.id,
      updatedField: field,
      newValue: value
    }, null, 2));
    
    res.json({
      success: true,
      vehicleId,
      updatedField: field,
      oldValue: vehicleResponse.data[field],
      newValue: value,
      ...updateResponse.data
    });
  } catch (error) {
    console.error('\n----- API ERROR: Update vehicle field -----');
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log('=================================');
  console.log(`MotorK AI Videos POC Server`);
  console.log(`Running on port: ${PORT} | Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Runway API: ${RUNWAY_API_KEY ? 'Configured ✓' : 'Not configured ✗'}`);
  console.log('=================================');
});
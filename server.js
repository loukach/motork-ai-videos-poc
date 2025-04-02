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

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const reqId = Date.now().toString(36).slice(-4);
  
  // Log request with clear separation
  console.log(`\n----- REQUEST [${reqId}] ${timestamp} -----`);
  console.log(`${req.method} ${req.url}`);
  
  // Prettify headers - hide authorization token details
  const headers = { ...req.headers };
  if (headers.authorization) {
    headers.authorization = headers.authorization.replace(/Bearer .+/, 'Bearer [TOKEN_HIDDEN]');
  }
  console.log('Headers:', JSON.stringify(headers, null, 2));
  
  // Only log query and body if they exist
  if (Object.keys(req.query).length > 0) {
    console.log('Query:', JSON.stringify(req.query, null, 2));
  }
  
  // Sanitize password in auth requests
  let bodyToLog = req.body;
  if (req.url.includes('/auth/token') && bodyToLog.password) {
    bodyToLog = { ...bodyToLog, password: '[HIDDEN]' };
  }
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(bodyToLog, null, 2));
  }
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    console.log(`\n----- RESPONSE [${reqId}] -----`);
    
    // Handle both string and object responses
    if (typeof body === 'string') {
      // Try to parse as JSON for better formatting
      try {
        if (body.startsWith('{') || body.startsWith('[')) {
          const jsonBody = JSON.parse(body);
          console.log(JSON.stringify(jsonBody, null, 2).substring(0, 500) + 
                    (JSON.stringify(jsonBody).length > 500 ? '...' : ''));
        } else {
          console.log(body.substring(0, 500) + (body.length > 500 ? '...' : ''));
        }
      } catch (e) {
        console.log(body.substring(0, 500) + (body.length > 500 ? '...' : ''));
      }
    } else {
      console.log(JSON.stringify(body, null, 2).substring(0, 500) + 
                (JSON.stringify(body).length > 500 ? '...' : ''));
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
            
            // Log the request payload for debugging
            const payload = {
              promptText: videoPrompt,
              promptImage: imageUrl,
              model: 'gen3a_turbo',
              duration: 5, // Duration in seconds
              parameters: {
                style: style || 'cinematic'
              }
            };
            console.log('Request payload to Runway API:');
            console.log(JSON.stringify(payload, null, 2));
            
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
            let maxAttempts = 30;
            let attempts = 0;
            
            while (!taskCompleted && attempts < maxAttempts) {
              console.log(`Checking task status (attempt ${attempts + 1}/${maxAttempts})...`);
              const taskStatus = await runway.tasks.retrieve(runwayTaskId);
              
              if (taskStatus.status === 'succeeded') {
                taskCompleted = true;
                // Extract the video URL from the task result
                videoUrl = taskStatus.output.urls?.mp4 || taskStatus.output.mp4 || taskStatus.output.video;
                console.log(`Task completed! Video URL: ${videoUrl}`);
              } else if (taskStatus.status === 'failed') {
                throw new Error(`Task failed: ${taskStatus.error || 'Unknown error'}`);
              } else {
                // Task is still processing
                console.log(`Task status: ${taskStatus.status} - waiting...`);
                // Wait 10 seconds before checking again
                await new Promise(resolve => setTimeout(resolve, 10000));
                attempts++;
              }
            }
            
            if (!taskCompleted) {
              throw new Error('Task timed out after maximum polling attempts');
            }
          } catch (error) {
            console.error(`Runway API error: ${error.message}`);
            
            // Additional detailed error logging
            console.error('Detailed error information:');
            if (error.response) {
              // The request was made and the server responded with a status code
              // that falls out of the range of 2xx
              console.error(`Status: ${error.response.status}`);
              console.error('Response headers:', JSON.stringify(error.response.headers, null, 2));
              console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
              // The request was made but no response was received
              console.error('No response received from server');
              console.error('Request details:', error.request);
            } else {
              // Something happened in setting up the request that triggered an Error
              console.error('Error details:', error.stack);
            }
            
            // Try to get the first image directly to check if it's accessible
            console.log('Attempting to check image accessibility...');
            try {
              const checkImageResponse = await axios.head(selectedImage.url);
              console.log(`Image check result: HTTP ${checkImageResponse.status}`);
              console.log('Image content type:', checkImageResponse.headers['content-type']);
            } catch (imageCheckError) {
              console.error(`Failed to access image: ${imageCheckError.message}`);
            }
            
            // Re-throw the error to be caught by the outer try/catch
            throw error;
          }
        }
        
        // Update task with video URL and completion status
        videoTasks.get(taskId).status = 'completed';
        videoTasks.get(taskId).videoUrl = videoUrl;
        // runwayTaskId already stored earlier
        videoTasks.get(taskId).completedAt = new Date().toISOString();
        
        console.log(`\n----- RUNWAY SUCCESS: Video generated successfully -----`);
        console.log(`Video URL: ${videoUrl}`);
      } catch (error) {
        console.error(`\n----- ERROR in background task: ${error.message} -----`);
        videoTasks.get(taskId).status = 'failed';
        videoTasks.get(taskId).error = error.message;
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
    runwayTaskId: task.runwayTaskId, // Include the Runway task ID
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
    
    res.json({
      success: true,
      vehicleId,
      videoUrl: finalVideoUrl,
      message: 'Video attached to vehicle successfully'
    });
  } catch (error) {
    console.error('\n----- ERROR: Attaching video to vehicle -----');
    console.error(`Message: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log('=================================');
  console.log(`MotorK API Proxy started`);
  console.log(`Server running on port: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth endpoint: https://auth.motork.io/realms/prod/protocol/openid-connect/token`);
  console.log(`Vehicle API endpoint: https://carspark-api.dealerk.com/it/vehicle`);
  console.log(`Runway API: ${RUNWAY_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`Available endpoints:`);
  console.log(`  - POST /auth/token`);
  console.log(`  - GET /vehicles`);
  console.log(`  - GET /vehicle/:vehicleId`);
  console.log(`  - GET /vehicle/:vehicleId/images/gallery`);
  console.log(`  - POST /vehicle/:vehicleId/images/gallery/upload`);
  console.log(`  - DELETE /vehicle/:vehicleId/images/gallery/:imageId`);
  console.log(`  - POST /vehicle/:vehicleId/generate-video`);
  console.log(`  - GET /vehicle/video/:taskId`);
  console.log(`  - POST /vehicle/:vehicleId/attach-video`);
  console.log('=================================');
});
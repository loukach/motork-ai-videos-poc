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
const { Runway } = require('@runwayml/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Runway API Configuration
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
let runway;
if (RUNWAY_API_KEY) {
  runway = new Runway({ apiKey: RUNWAY_API_KEY });
}

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

// Helper function to download image from URL to a temporary file
async function downloadImage(url, destinationPath) {
  const writer = fs.createWriteStream(destinationPath);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

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
    
    // Step 3: Create temp directory for downloaded images
    const taskId = Date.now().toString();
    const tempDir = path.join(__dirname, 'temp', `vehicle_${vehicleId}_${taskId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Store task in memory
    videoTasks.set(taskId, {
      vehicleId,
      status: 'downloading',
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
        // Step 4: Download the first image only (Runway might only support one image for generation)
        const imageUrl = images[0].url;
        const imagePath = path.join(tempDir, `primary_image.jpg`);
        
        try {
          await downloadImage(imageUrl, imagePath);
          console.log(`Downloaded primary image from ${imageUrl}`);
          
          // Update task status
          videoTasks.get(taskId).status = 'processing';
          videoTasks.get(taskId).imagePath = imagePath;
          
          // Step 5: Prepare data for Runway API
          // Build a prompt based on vehicle details if none provided
          const defaultPrompt = `A professional, high-quality video showcasing a ${vehicleData.year} ${vehicleData.brand} ${vehicleData.model} in ${vehicleData.exteriorColorName || 'its color'}. Show the car from different angles, highlighting its features.`;
          const videoPrompt = prompt || defaultPrompt;
          
          console.log(`\n----- RUNWAY REQUEST: Starting video generation -----`);
          console.log(`Prompt: ${videoPrompt}`);
          
          // Step 6: Call Runway API to generate video
          const model = 'gen-2';
          const input = {
            prompt: videoPrompt,
            image: imagePath,
            mode: 'image_to_video', // or other appropriate mode
            style: style || 'cinematic'  // Default to cinematic style if not specified
          };
          
          console.log(`Using Runway model: ${model}`);
          
          // Submit generation request to Runway
          const { videoUrl, runwayTaskId } = await new Promise((resolve, reject) => {
            runway.generate({
              model,
              input
            }).then(result => {
              resolve({
                videoUrl: result.output.video,
                runwayTaskId: result.id
              });
            }).catch(error => {
              reject(error);
            });
          });
          
          // Update task with video URL
          videoTasks.get(taskId).status = 'completed';
          videoTasks.get(taskId).videoUrl = videoUrl;
          videoTasks.get(taskId).runwayTaskId = runwayTaskId;
          videoTasks.get(taskId).completedAt = new Date().toISOString();
          
          console.log(`\n----- RUNWAY SUCCESS: Video generated successfully -----`);
          console.log(`Video URL: ${videoUrl}`);
          
          // Clean up temporary files
          try {
            fs.unlinkSync(imagePath);
            fs.rmdirSync(tempDir);
            console.log(`Cleaned up temporary files`);
          } catch (cleanupError) {
            console.error(`Cleanup error: ${cleanupError.message}`);
          }
        } catch (downloadError) {
          console.error(`Error downloading image: ${downloadError.message}`);
          videoTasks.get(taskId).status = 'failed';
          videoTasks.get(taskId).error = 'Failed to download vehicle image';
        }
      } catch (error) {
        console.error(`\n----- ERROR in background task: ${error.message} -----`);
        videoTasks.get(taskId).status = 'failed';
        videoTasks.get(taskId).error = error.message;
        
        // Clean up temp directory on error
        try {
          if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
              fs.unlinkSync(path.join(tempDir, file));
            }
            fs.rmdirSync(tempDir);
          }
        } catch (cleanupError) {
          console.error(`Cleanup error: ${cleanupError.message}`);
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
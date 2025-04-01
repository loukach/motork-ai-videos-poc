const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log('=================================');
  console.log(`MotorK API Proxy started`);
  console.log(`Server running on port: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth endpoint: https://auth.motork.io/realms/prod/protocol/openid-connect/token`);
  console.log(`Vehicle API endpoint: https://carspark-api.dealerk.com/it/vehicle`);
  console.log(`Available endpoints:`);
  console.log(`  - POST /auth/token`);
  console.log(`  - GET /vehicles`);
  console.log(`  - GET /vehicle/:vehicleId`);
  console.log(`  - GET /vehicle/:vehicleId/images/gallery`);
  console.log(`  - POST /vehicle/:vehicleId/images/gallery/upload`);
  console.log(`  - DELETE /vehicle/:vehicleId/images/gallery/:imageId`);
  console.log('=================================');
});
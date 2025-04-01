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
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  console.log('Headers:', JSON.stringify(req.headers));
  console.log('Query:', JSON.stringify(req.query));
  console.log('Body:', JSON.stringify(req.body));
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    console.log(`[${timestamp}] Response:`, body.substring ? body.substring(0, 200) + (body.length > 200 ? '...' : '') : body);
    return originalSend.apply(res, arguments);
  };
  
  next();
});

// Authentication endpoint
app.post('/auth/token', async (req, res) => {
  try {
    console.log('[API Request] Auth token request to MotorK');
    const response = await axios({
      method: 'post',
      url: 'https://auth.motork.io/realms/prod/protocol/openid-connect/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams(req.body)
    });
    
    console.log('[API Response] Auth token successful:', 
      JSON.stringify({
        access_token: response.data.access_token ? `${response.data.access_token.substring(0, 20)}...` : undefined,
        token_type: response.data.token_type,
        expires_in: response.data.expires_in,
        scope: response.data.scope
      })
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('[API Error] Auth token failed:', error.message, error.response?.data);
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Vehicle listing endpoint
app.get('/vehicles', async (req, res) => {
  try {
    const { page = 0, size = 10 } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.warn('[Auth Error] Missing authorization header');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`[API Request] Vehicle listing request (page=${page}, size=${size})`);
    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/it/vehicle?page=${page}&size=${size}`,
      headers: {
        'Authorization': authHeader
      }
    });
    
    console.log('[API Response] Vehicle listing successful:',
      JSON.stringify({
        totalElements: response.data.totalElements,
        totalPages: response.data.totalPages,
        size: response.data.size,
        vehicleCount: response.data.content?.length || 0
      })
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('[API Error] Vehicle listing failed:', error.message, error.response?.data);
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
      console.warn('[Auth Error] Missing authorization header');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`[API Request] Single vehicle request (vehicleId=${vehicleId}, country=${country})`);
    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}`,
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });
    
    console.log('[API Response] Single vehicle request successful:',
      JSON.stringify({
        vehicleId: response.data.id,
        brand: response.data.brand,
        model: response.data.model
      })
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('[API Error] Single vehicle request failed:', error.message, error.response?.data);
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
      console.warn('[Auth Error] Missing authorization header');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`[API Request] Vehicle gallery images request (vehicleId=${vehicleId}, country=${country})`);
    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}/images/gallery`,
      headers: {
        'Authorization': authHeader,
        'Accept': '*/*'
      }
    });
    
    console.log('[API Response] Vehicle gallery images successful:',
      JSON.stringify({
        status: response.status,
        imageCount: Array.isArray(response.data) ? response.data.length : 'N/A'
      })
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('[API Error] Vehicle gallery images failed:', error.message, error.response?.data);
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
      console.warn('[Auth Error] Missing authorization header');
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    if (!req.file) {
      console.warn('[Upload Error] No file provided');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const fileSize = req.file.size;
    const fileName = req.file.originalname;
    
    console.log(`[API Request] Vehicle gallery image upload (vehicleId=${vehicleId}, country=${country}, fileSize=${fileSize} bytes, fileName=${fileName})`);
    
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
    
    console.log('[API Response] Vehicle gallery image upload successful:',
      JSON.stringify({
        status: response.status,
        response: typeof response.data === 'object' ? response.data : 'Raw response'
      })
    );
    
    // Clean up - remove the temporary file
    fs.unlink(filePath, (err) => {
      if (err) console.error(`[Error] Failed to delete temporary file: ${filePath}`, err);
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('[API Error] Vehicle gallery image upload failed:', error.message, error.response?.data);
    
    // Clean up temp file even if upload fails
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error(`[Error] Failed to delete temporary file: ${req.file.path}`, err);
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
      console.warn('[Auth Error] Missing authorization header');
      return res.status(401).json({ error: 'Authorization header required' });
    }

    console.log(`[API Request] Vehicle gallery image delete (vehicleId=${vehicleId}, imageId=${imageId}, country=${country})`);
    const response = await axios({
      method: 'delete',
      url: `https://carspark-api.dealerk.com/${country}/vehicle/${vehicleId}/images/gallery/${imageId}`,
      headers: {
        'Authorization': authHeader,
        'Accept': '*/*'
      }
    });
    
    console.log('[API Response] Vehicle gallery image delete successful:',
      JSON.stringify({
        status: response.status,
        statusText: response.statusText
      })
    );
    
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error('[API Error] Vehicle gallery image delete failed:', error.message, error.response?.data);
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
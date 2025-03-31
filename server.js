const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log('=================================');
  console.log(`MotorK API Proxy started`);
  console.log(`Server running on port: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth endpoint: https://auth.motork.io/realms/prod/protocol/openid-connect/token`);
  console.log(`Vehicle API endpoint: https://carspark-api.dealerk.com/it/vehicle`);
  console.log('=================================');
});
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

// Authentication endpoint
app.post('/auth/token', async (req, res) => {
  try {
    const response = await axios({
      method: 'post',
      url: 'https://auth.motork.io/realms/prod/protocol/openid-connect/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams(req.body)
    });
    
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

// Vehicle listing endpoint
app.get('/vehicles', async (req, res) => {
  try {
    const { page = 0, size = 10 } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const response = await axios({
      method: 'get',
      url: `https://carspark-api.dealerk.com/it/vehicle?page=${page}&size=${size}`,
      headers: {
        'Authorization': authHeader
      }
    });
    
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
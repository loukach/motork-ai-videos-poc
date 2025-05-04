# MotorK AI Videos POC

A Node.js server for generating AI videos from vehicle listings using Runway ML.

## Installation

```bash
npm install
```

## Start the Server

### Development (Local)

```bash
npm start
```

The server will run on port 3000 by default. You can change this by setting the PORT environment variable.

### Production (Cloud)

In production, the server is hosted on Render with the following base URL:

```
https://motork-ai-videos-poc.onrender.com
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `RUNWAY_API_KEY`: API key for Runway ML
- `API_BASE_URL`: Base URL for vehicle data API
- `AUTH_API_URL`: URL for authentication service
- `N8N_TEST_WEBHOOK_URL`: Webhook URL for testing
- `N8N_PROD_WEBHOOK_URL`: Webhook URL for production
- `DEFAULT_COUNTRY`: Default country code (default: 'it')
- `LOG_LEVEL`: Logging verbosity (options: error, warn, info, debug)

Copy the `.env.example` file to create your own `.env` file:

```bash
cp .env.example .env
```

Then edit the `.env` file and add your API keys and other configuration values.

### Security Recommendations

Before deploying to production, please implement these security measures:

1. Implement proper input validation for all API endpoints
2. Add rate limiting for authentication and API endpoints
3. Configure CORS settings appropriately for your environment
4. Move all hard-coded URLs to environment variables (as shown in `.env.example`)
5. Implement proper authentication token validation
6. Add request timeouts for all external API calls
7. Improve error handling with proper sanitization of error messages

### Logging Configuration

You can control logging verbosity by setting the `LOG_LEVEL` environment variable:

- `error`: Only show errors
- `warn`: Show warnings and errors
- `info`: Show regular informational logs (default)
- `debug`: Show all logs including verbose debugging info

For example:
```
LOG_LEVEL=debug npm start
```

The server will automatically filter frequent image gallery requests when running with default `info` level to reduce log volume.

## API Documentation

The API is documented using OpenAPI (Swagger) specification. You can access the interactive documentation at:

- **Development:** `http://localhost:3000/swagger-ui`
- **Production:** `https://motork-ai-videos-poc.onrender.com/swagger-ui`

The Swagger UI provides:
- Complete endpoint documentation
- Interactive "Try it out" functionality to test API calls
- Request/response examples
- Authentication support
- Schema models

## API Endpoints

### Base URLs

- **Development:** `http://localhost:3000`
- **Production:** `https://motork-ai-videos-poc.onrender.com`

### Authentication

```
POST /auth/token
```

Request body (application/x-www-form-urlencoded):
```
grant_type=password
client_id=carspark-api
username=your_username
password=your_password
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "scope": "read write"
}
```

### Vehicle Listing

```
GET /vehicles?page=0&size=10
```

Query Parameters:
- `page` - Page number (default: 0)
- `size` - Number of vehicles per page (default: 20)
- `country` - Country code (default: 'it')

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
{
  "content": [
    {
      "id": "7199514",
      "brand": "Toyota",
      "model": "Corolla",
      "year": 2022,
      "exteriorColorName": "Red",
      "videoUrl": "https://short.url/abc123"
    },
    ...
  ],
  "totalElements": 542,
  "totalPages": 28,
  "size": 20
}
```

### Get Single Vehicle

```
GET /vehicle/:vehicleId
```

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
{
  "id": "7199514",
  "brand": "Toyota",
  "model": "Corolla",
  "year": 2022,
  "exteriorColorName": "Red",
  "videoUrl": "https://short.url/abc123"
}
```

### Get Vehicle Images

```
GET /vehicle/:vehicleId/images/gallery
```

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
[
  {
    "id": "12345",
    "url": "https://example.com/image1.jpg"
  },
  {
    "id": "12346",
    "url": "https://example.com/image2.jpg"
  }
]
```

### Upload Image to Vehicle Gallery

```
POST /vehicle/:vehicleId/images/gallery/upload
```

Request format: multipart/form-data with 'file' field containing image.

Required headers:
```
Authorization: Bearer your_token
```

### Delete Image from Gallery

```
DELETE /vehicle/:vehicleId/images/gallery/:imageId
```

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
{
  "success": true,
  "vehicleId": "7199514",
  "imageId": "12345"
}
```

### Video Generation

```
POST /vehicle/:vehicleId/generate-video
```

Request body (JSON):
```json
{
  "prompt": "Optional custom prompt for video",
  "style": "cinematic",
  "duration": 5,
  "ratio": "1280:768"
}
```

Parameters:
- `prompt` - Custom prompt for video generation (optional)
- `style` - Video style, e.g., "cinematic" (optional)
- `duration` - Video duration in seconds (default: 5)
- `ratio` - Video aspect ratio (optional)

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
{
  "taskId": "1234567890",
  "vehicleId": "7199514",
  "status": "processing",
  "message": "Video generation started. Use the /vehicle/video/:taskId endpoint to check status."
}
```

### Video Status

```
GET /vehicle/video/:taskId
```

Response:
```json
{
  "taskId": "1234567890",
  "vehicleId": "7199514",
  "status": "completed",
  "videoUrl": "https://short.url/abc123",
  "originalVideoUrl": "https://runway.com/video.mp4",
  "createdAt": "2023-06-14T12:34:56.789Z",
  "completedAt": "2023-06-14T12:36:45.123Z"
}
```

Possible status values:
- `processing` - Initial state, task created
- `processing_runway` - Processing in Runway ML
- `completed` - Video generated successfully
- `failed` - Video generation failed

### Get Video Generation Task History

```
GET /vehicle/video-history
```

Query Parameters:
- `vehicleId` - Filter by vehicle ID (optional)
- `status` - Filter by task status (optional)
- `month` - Filter by month (optional)
- `limit` - Limit number of results (optional)

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
{
  "count": 10,
  "history": [
    {
      "taskId": "1234567890",
      "vehicleId": "7199514",
      "status": "completed",
      "videoUrl": "https://short.url/abc123",
      "createdAt": "2023-06-14T12:34:56.789Z",
      "completedAt": "2023-06-14T12:36:45.123Z"
    },
    ...
  ]
}
```

### Update Vehicle Field

```
PUT /vehicle/:vehicleId/update-field
```

Request body (JSON):
```json
{
  "field": "videoUrl",
  "value": "https://short.url/abc123"
}
```

Required headers:
```
Authorization: Bearer your_token
```

Response:
```json
{
  "vehicleId": "7199514",
  "updatedField": "videoUrl",
  "oldValue": "https://old-url.com/video.mp4",
  "newValue": "https://short.url/abc123"
}
```

### N8N Proxy

```
POST /n8n-proxy
```

Request body (JSON):
```json
{
  "sessionId": "unique-session-id",
  "message": "User message",
  "page": "optional-page-context",
  "lastResponse": "optional-previous-response"
}
```

Required headers:
```
Authorization: Bearer your_token
```

## Example Front-end Usage

### Development

```javascript
const DEV_BASE_URL = 'http://localhost:3000';

// Authentication
async function login(username, password) {
  const response = await fetch(`${DEV_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'carspark-api',
      username,
      password
    })
  });
  
  return await response.json();
}

// Vehicle listing
async function getVehicles(token, page = 0, size = 10) {
  const response = await fetch(`${DEV_BASE_URL}/vehicles?page=${page}&size=${size}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
}

// Generate video
async function generateVideo(token, vehicleId, options = {}) {
  const response = await fetch(`${DEV_BASE_URL}/vehicle/${vehicleId}/generate-video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(options) // prompt, style, duration, ratio
  });
  
  return await response.json();
}

// Check video status
async function checkVideoStatus(taskId) {
  const response = await fetch(`${DEV_BASE_URL}/vehicle/video/${taskId}`);
  return await response.json();
}
```

### Production

```javascript
const PROD_BASE_URL = 'https://motork-ai-videos-poc.onrender.com';

// Authentication in production
async function login(username, password) {
  const response = await fetch(`${PROD_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'carspark-api',
      username,
      password
    })
  });
  
  return await response.json();
}

// All other API calls follow the same pattern - just use PROD_BASE_URL instead of DEV_BASE_URL
```
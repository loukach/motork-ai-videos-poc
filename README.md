# MotorK AI Videos POC

A Node.js server for generating AI videos from vehicle listings using Runway ML.

## Installation

```bash
npm install
```

## Start the Server

```bash
npm start
```

The server will run on port 3000 by default. You can change this by setting the PORT environment variable.

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `RUNWAY_API_KEY`: API key for Runway ML
- `API_BASE_URL`: Base URL for vehicle data API
- `LOG_LEVEL`: Logging verbosity (options: error, warn, info, debug)

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

## API Endpoints

### Authentication

```
POST http://localhost:3000/auth/token
```

Request body (application/x-www-form-urlencoded):
```
grant_type=password
client_id=carspark-api
username=your_username
password=your_password
```

### Vehicle Listing

```
GET http://localhost:3000/vehicles?page=0&size=10
```

Required headers:
```
Authorization: Bearer your_token
```

### Video Generation

```
POST http://localhost:3000/vehicle/:vehicleId/generate-video
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
GET http://localhost:3000/vehicle/video/:taskId
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

## Example Front-end Usage

```javascript
// Authentication
async function login(username, password) {
  const response = await fetch('http://localhost:3000/auth/token', {
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
  const response = await fetch(`http://localhost:3000/vehicles?page=${page}&size=${size}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
}
```
# MotorK API Proxy Server

A simple Node.js proxy server to resolve CORS issues between Lovable front-end and Carspark API.

## Installation

```bash
npm install
```

## Start the Server

```bash
npm start
```

The server will run on port 3000 by default. You can change this by setting the PORT environment variable.

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
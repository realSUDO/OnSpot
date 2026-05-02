# OnSpot - Real-Time Location Tracking System

A real-time location sharing application built with Kafka event streaming, Socket.IO, and OAuth 2.0 authentication. Users can share their live location and see others moving on a map in real-time.

**Live Demo:** https://onspot.sudohq.me  
**Demo Video:** [YouTube Link - Coming Soon]

---

## Project Overview

OnSpot is a location tracking system where authenticated users can share their location and see others on a map. The system uses Kafka as the central event bus to decouple location event production from consumption, allowing independent scaling of real-time broadcasting and database persistence.

This architecture is similar to what ride-sharing apps like Uber or delivery platforms like DoorDash use, where millions of location updates need to be processed, stored, and broadcast to users without blocking the main application flow.

---

## Tech Stack

**Backend**
- Node.js with Express
- Socket.IO for WebSocket communication
- KafkaJS for event streaming
- OAuth 2.0 for authentication

**Frontend**
- Vanilla JavaScript
- Leaflet.js for interactive maps
- Socket.IO client

**Infrastructure**
- Apache Kafka (event broker)
- Docker for local Kafka setup
- Nginx as reverse proxy
- PM2 for process management

---

## Core Features

**Authentication**
- OAuth 2.0 authorization code flow
- JWT-based socket authentication
- Login-gated location sharing
- User identity tracked throughout the system

**Real-Time Tracking**
- Automatic location updates via browser Geolocation API
- Live marker updates on map
- Multi-user tracking
- Stale user removal after 30 seconds of inactivity

**Event Streaming**
- Kafka producer publishes location events
- Two consumer groups process events independently
- User ID as message key for ordering guarantees
- Timestamp tracking for event sequencing

**Persistence**
- Separate database processor consumer
- Asynchronous location history logging
- Decoupled from real-time broadcast logic

---

## Setup Instructions

### Prerequisites
- Node.js 18 or higher
- Docker for running Kafka
- OAuth 2.0 provider (SudoAuth or custom)

### Installation

Clone the repository:
```bash
git clone https://github.com/realSUDO/OnSpot.git
cd OnSpot
```

Install dependencies:
```bash
npm install
```

Start Kafka using Docker:
```bash
docker compose up -d
```

Create the Kafka topic:
```bash
node kafka-admin.js
```

Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your OAuth credentials:
```env
PORT=8000
AUTH_API=https://auth.sudohq.me
AUTH_CLIENT_ID=your_client_id
AUTH_CLIENT_SECRET=your_client_secret
```

Start the main server:
```bash
npm start
```

In a separate terminal, start the database processor:
```bash
npm run db-processor
```

Open your browser to `http://localhost:8000`

---

## OAuth 2.0 Configuration

### Using SudoAuth

Register at https://auth.sudohq.me and create an OAuth application. Set the redirect URI to `https://your-domain.com/auth/callback`. Copy the Client ID and Client Secret to your `.env` file.

### Using a Custom Provider

Your OAuth provider needs to support:
- Authorization Code flow
- Standard endpoints: `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`
- User info response with `sub` (user ID), `name`, and `email` fields

---

## System Architecture

### Authentication Flow

1. User clicks Login and is redirected to the OAuth provider
2. User authenticates with email and password
3. Provider redirects back with an authorization code
4. Frontend sends code to server's `/auth/callback` endpoint
5. Server exchanges code for access token and refresh token
6. Frontend fetches user info using the access token
7. Tokens are stored in localStorage
8. Page reloads and socket reconnects with the token in handshake

### Location Update Flow

1. User clicks "Share My Location"
2. Browser requests geolocation permission
3. `watchPosition()` continuously sends location updates
4. Frontend emits `client:location:update` event via Socket.IO
5. Server validates JWT from socket handshake
6. Server publishes event to Kafka topic `location-updates`
   - Message key: userId (from JWT)
   - Message value: `{ userId, socketId, name, latitude, longitude, timestamp }`
7. Consumer Group 1 (`socket-server-{PORT}`) receives event and broadcasts to all clients
8. Consumer Group 2 (`db-processor`) receives same event and writes to log file
9. All connected clients update marker positions on their maps

### Stale User Handling

The server tracks the last seen timestamp for each user. Every 30 seconds, it checks for users who haven't sent updates and emits a `server:user:disconnected` event. Clients remove the marker from the map when they receive this event.

---

## Why Kafka?

### The Problem with Direct Database Writes

When every socket event triggers an immediate database write:
- The socket handler blocks waiting for the database response
- Database becomes a bottleneck under high load
- No built-in retry mechanism if the database is temporarily unavailable
- Difficult to add new consumers of location data (analytics, notifications, etc.)

### How Kafka Solves This

Kafka decouples event production from consumption:
- Socket server publishes events and returns immediately
- Multiple consumers process events independently at their own pace
- Database writes happen asynchronously without blocking real-time updates
- Built-in durability and replay capabilities
- Easy to add new consumers without changing the producer

### Consumer Groups Explained

**Group 1: socket-server-{PORT}**
- Purpose: Real-time broadcast to connected clients
- Optimized for low latency (under 10ms)
- Processes every event immediately
- Multiple instances can run for load balancing

**Group 2: db-processor**
- Purpose: Persist location history
- Can tolerate higher latency (100-500ms)
- Can batch writes for efficiency
- Scales independently from socket servers

### Why User ID as Message Key

Using the user ID as the Kafka message key ensures:
- All events for a specific user go to the same partition
- Event ordering is maintained per user
- Supports multiple browser sessions per user
- Enables efficient user-level queries and analytics

---

## Project Structure

```
OnSpot/
├── index.js              Main server with Express, Socket.IO, and Kafka producer
├── db-processor.js       Kafka consumer for location history persistence
├── kafka-client.js       Kafka client configuration
├── kafka-admin.js        Script to create Kafka topics
├── docker-compose.yml    Kafka container setup
├── package.json
├── .env.example
├── public/
│   ├── index.html        Single-page application shell
│   ├── app.js            Frontend JavaScript
│   ├── style.css         Notion-inspired styles
│   └── favicon.png
└── location-history.log  Generated by db-processor
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| PORT | Server port | 8000 |
| AUTH_API | OAuth provider base URL | https://auth.sudohq.me |
| AUTH_CLIENT_ID | OAuth client ID | abc123... |
| AUTH_CLIENT_SECRET | OAuth client secret | xyz789... |

The client secret is only used server-side and never sent to the browser.

---

## Demo Video

The demo video shows:
1. Complete OAuth login flow
2. Browser location permission request
3. Real-time location sharing
4. Two browser windows with different users showing live updates
5. Kafka consumer logs in terminal
6. Database processor writing to location-history.log
7. Stale user removal after inactivity
8. Start and stop sharing functionality

---

## Testing Multi-User Scenarios

### Two Browser Windows

Open the app in Chrome and Firefox (or use incognito mode). Login with different accounts in each browser. Click "Share My Location" in both windows. You should see both markers on the map updating in real-time.

### Two Devices

Deploy the app to a server with a public domain. Open it on your phone and laptop. Login with different accounts. Share location on both devices and observe the real-time updates.

---

## Assumptions and Limitations

### Assumptions

- Users have modern browsers with Geolocation API support
- OAuth provider is available and responsive
- Kafka is running and accessible
- Users grant location permission when prompted

### Current Limitations

- Location accuracy depends on device GPS capabilities
- Falls back to manual map click if GPS is unavailable
- No historical location playback, only live tracking
- Uses file-based logging instead of a production database
- Single Kafka broker without replication
- No rate limiting on location update frequency
- Markers are removed after 30 seconds of inactivity (not configurable)

### Production Improvements

For a production deployment, you would want to:
- Use PostgreSQL or MongoDB for location history
- Add Redis for session management
- Implement rate limiting (e.g., max 10 updates per second per user)
- Set up a Kafka cluster with replication for fault tolerance
- Add location validation and geofencing
- Implement user privacy controls
- Store location trails for route replay
- Add an analytics dashboard

---

## System Design Decisions

### High-Throughput Architecture

**Why Kafka instead of direct database writes?**

Kafka can handle over a million events per second, while database writes are typically much slower. By using Kafka, the socket server doesn't wait for database operations to complete. Events can be replayed if needed, and multiple consumers can process the same event stream for different purposes.

**Why use user ID as the message key?**

This maintains event ordering per user, enables partition-level parallelism, supports multiple sessions per user, and simplifies user-level queries.

**Why separate consumer groups?**

The socket-server consumer is optimized for low latency to provide real-time updates. The db-processor consumer can batch writes and handle retries without affecting real-time performance. They scale independently and failures are isolated.

**Why remove stale users?**

This prevents map clutter, reduces memory usage, and handles cases where users close their browser or lose network connection without properly disconnecting.

**Why JWT in socket handshake?**

JWT provides stateless authentication. The server doesn't need to look up sessions on every event. User identity is available in the socket context, and this approach works across multiple server instances.

### Real-World Parallels

Uber and Lyft use similar architectures where driver locations flow through an event stream to update rider apps. The same event is used for ETA calculations, surge pricing, and analytics.

DoorDash and Zomato track delivery person locations through event streams to update customer tracking interfaces. The same events are stored in databases, trigger notifications, and update ETAs.

Fleet management systems send vehicle GPS data through event streams to update dashboards. The same events trigger geofence alerts, optimize routes, and generate compliance logs.

---

## Code Quality

The codebase follows these principles:
- Separated concerns (server, processor, frontend)
- Environment variables for all configuration
- Error handling in async operations
- Clean naming conventions
- Minimal dependencies
- Mobile-responsive UI
- Proper gitignore for secrets and logs

---

## License

MIT

---

## Author

SUDO  
GitHub: @realSUDO

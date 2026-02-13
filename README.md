# SongLink Backend

Backend API server for SongLink music prediction app.

## Features

- User authentication (JWT)
- WebSocket real-time communication
- Music search (Spotify, Apple Music, YouTube)
- SQLite database
- Multi-user support

## Deploy to Render

1. **Push to GitHub**:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/songlink-backend.git
git push -u origin main
```

2. **Create Web Service on Render**:
   - Go to render.com → New → Web Service
   - Connect your GitHub repo
   - Name: `songlink-backend` (or your choice)
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free

3. **Add Environment Variables**:
   
   **Required:**
   ```
   JWT_SECRET=your-random-secret-here
   SPECTATOR_URL=https://your-spectator-app.onrender.com
   ```
   
   **Optional (for music search):**
   ```
   SPOTIFY_CLIENT_ID=your_id
   SPOTIFY_CLIENT_SECRET=your_secret
   APPLE_MUSIC_TOKEN=your_token
   YOUTUBE_API_KEY=your_key
   ```

4. **Deploy!**

## Get API Credentials

### Spotify
1. Go to https://developer.spotify.com/dashboard
2. Create an app
3. Copy Client ID and Client Secret

### YouTube
1. Go to https://console.cloud.google.com
2. Create project
3. Enable YouTube Data API v3
4. Create API Key

### Apple Music
1. Go to https://developer.apple.com
2. Create MusicKit identifier
3. Generate JWT token

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm start
```

Server runs on http://localhost:3000

## API Endpoints

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/user` - Get user profile
- `PUT /api/user/settings` - Update settings
- `GET /api/status` - Check connection status
- `POST /api/send` - Send song to spectator

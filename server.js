require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Database setup
const db = new Database('songlink.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    default_timestamp INTEGER DEFAULT 45,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    service TEXT,
    status TEXT DEFAULT 'waiting',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const SPECTATOR_URL = process.env.SPECTATOR_URL || 'http://localhost:3001';

// Middleware
app.use(cors());
app.use(express.json());

// Store active WebSocket connections
const connections = new Map(); // sessionId -> ws

// WebSocket handling
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const username = url.searchParams.get('username');
  
  console.log('WebSocket connection for username:', username);
  
  if (username) {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (user) {
      connections.set(username, ws);
      console.log('✅ WebSocket connected for:', username);
      
      ws.on('close', () => {
        console.log('WebSocket closed for:', username);
        connections.delete(username);
      });
    } else {
      ws.close();
    }
  } else {
    ws.close();
  }
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Music search functions
async function searchSpotify(query) {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials not configured');
  }

  try {
    // Get access token
    const tokenResponse = await axios.post('https://accounts.spotify.com/api/token',
      'grant_type=client_credentials', {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const token = tokenResponse.data.access_token;

    // Search tracks
    const searchResponse = await axios.get('https://api.spotify.com/v1/search', {
      params: { q: query, type: 'track', limit: 1 },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const track = searchResponse.data.tracks.items[0];
    if (track) {
      return { id: track.id, name: track.name, artist: track.artists[0].name };
    }
    return null;
  } catch (error) {
    console.error('Spotify search error:', error.message);
    return null;
  }
}

async function searchAppleMusic(query) {
  if (!process.env.APPLE_MUSIC_TOKEN) {
    throw new Error('Apple Music token not configured');
  }

  try {
    const response = await axios.get('https://api.music.apple.com/v1/catalog/us/search', {
      params: { term: query, types: 'songs', limit: 1 },
      headers: { 'Authorization': `Bearer ${process.env.APPLE_MUSIC_TOKEN}` }
    });

    const song = response.data.results.songs?.data[0];
    if (song) {
      return { id: song.id, name: song.attributes.name, artist: song.attributes.artistName };
    }
    return null;
  } catch (error) {
    console.error('Apple Music search error:', error.message);
    return null;
  }
}

async function searchYouTube(query) {
  if (!process.env.YOUTUBE_API_KEY) {
    throw new Error('YouTube API key not configured');
  }

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        q: query,
        part: 'snippet',
        type: 'video',
        videoCategoryId: '10', // Music category
        maxResults: 1,
        key: process.env.YOUTUBE_API_KEY
      }
    });

    const video = response.data.items[0];
    if (video) {
      return { id: video.id.videoId, name: video.snippet.title, artist: video.snippet.channelTitle };
    }
    return null;
  } catch (error) {
    console.error('YouTube search error:', error.message);
    return null;
  }
}

// API Routes

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate username (alphanumeric only)
  if (!/^[a-zA-Z0-9]+$/.test(username)) {
    return res.status(400).json({ error: 'Username must be alphanumeric' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const stmt = db.prepare('INSERT INTO users (email, password, username) VALUES (?, ?, ?)');
    const result = stmt.run(email, hashedPassword, username);

    const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET);
    
    res.json({ 
      token, 
      username,
      spectatorUrl: `${SPECTATOR_URL}/${username}`
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Email or username already exists' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  
  res.json({ 
    token, 
    username: user.username,
    defaultTimestamp: user.default_timestamp,
    spectatorUrl: `${SPECTATOR_URL}/${user.username}`
  });
});

// Get user profile
app.get('/api/user', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, email, username, default_timestamp FROM users WHERE id = ?')
    .get(req.user.id);
  
  res.json({
    ...user,
    spectatorUrl: `${SPECTATOR_URL}/${user.username}`
  });
});

// Update settings
app.put('/api/user/settings', authenticateToken, (req, res) => {
  const { defaultTimestamp } = req.body;
  
  if (defaultTimestamp !== undefined) {
    db.prepare('UPDATE users SET default_timestamp = ? WHERE id = ?')
      .run(defaultTimestamp, req.user.id);
  }
  
  res.json({ success: true });
});

// Get connection status
app.get('/api/status', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
  const isConnected = connections.has(user.username);
  
  res.json({ 
    connected: isConnected,
    username: user.username
  });
});

// Send song
app.post('/api/send', authenticateToken, async (req, res) => {
  const { songQuery, service } = req.body;
  
  const user = db.prepare('SELECT username, default_timestamp FROM users WHERE id = ?')
    .get(req.user.id);
  
  const ws = connections.get(user.username);
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(400).json({ error: 'Spectator not connected' });
  }

  try {
    // Search for the song
    let trackInfo;
    
    if (service === 'spotify') {
      trackInfo = await searchSpotify(songQuery);
    } else if (service === 'apple') {
      trackInfo = await searchAppleMusic(songQuery);
    } else if (service === 'youtube') {
      trackInfo = await searchYouTube(songQuery);
    }

    if (!trackInfo) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Send to spectator
    ws.send(JSON.stringify({
      type: 'play',
      service,
      trackId: trackInfo.id,
      timestamp: user.default_timestamp,
      name: trackInfo.name,
      artist: trackInfo.artist
    }));

    console.log(`✅ Sent "${trackInfo.name}" by ${trackInfo.artist} to ${user.username}`);
    
    res.json({ 
      success: true,
      track: trackInfo
    });
  } catch (error) {
    console.error('Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get service for username (used by spectator)
app.get('/api/spectator/:username/service', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({ exists: true });
});

// Set service for username (used by spectator)
app.post('/api/spectator/:username/service', (req, res) => {
  const { service } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Store service preference in memory or just acknowledge
  console.log(`Service selected for ${req.params.username}: ${service}`);
  
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎵 SongLink Backend running on port ${PORT}`);
  console.log(`Spectator URL: ${SPECTATOR_URL}`);
});

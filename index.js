import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';

import express from 'express';
import { Server } from 'socket.io';

import { kafkaClient } from './kafka-client.js';

const AUTH_API = process.env.AUTH_API ?? 'https://auth.sudohq.me';
const CLIENT_ID = process.env.AUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH_CLIENT_SECRET;

async function verifyToken(token) {
  try {
    const res = await fetch(`${AUTH_API}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.valid) return data.decoded;
  } catch {}
  return null;
}

async function main() {
  const PORT = process.env.PORT ?? 8000;

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server();

  // Exchange auth code for tokens (server-side, keeps client_secret safe)
  app.post('/auth/callback', async (req, res) => {
    const { code } = req.body;
    console.log('[/auth/callback] code received:', code?.slice(0, 10) + '...');
    if (!code) return res.status(400).json({ error: 'code required' });
    try {
      const body = {
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: `https://${req.get('host')}/auth/callback`,
      };
      console.log('[/auth/callback] exchanging with redirect_uri:', body.redirect_uri);
      const r = await fetch(`${AUTH_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      console.log('[/auth/callback] token response status:', r.status, JSON.stringify(data).slice(0, 100));
      res.status(r.status).json(data);
    } catch (e) {
      console.error('[/auth/callback] error:', e.message);
      res.status(500).json({ error: 'token exchange failed' });
    }
  });

  // Refresh token proxy (keeps client_secret server-side)
  app.post('/auth/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
    try {
      const r = await fetch(`${AUTH_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      });
      const data = await r.json();
      res.status(r.status).json(data);
    } catch (e) {
      res.status(500).json({ error: 'refresh failed' });
    }
  });

  const kafkaProducer = kafkaClient.producer();
  await kafkaProducer.connect();

  const kafkaConsumer = kafkaClient.consumer({
    groupId: `socket-server-${PORT}`,
  });
  await kafkaConsumer.connect();

  await kafkaConsumer.subscribe({
    topics: ['location-updates'],
    fromBeginning: true,
  });

  kafkaConsumer.run({
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const data = JSON.parse(message.value.toString());
      io.emit('server:location:update', {
        id: data.id,
        name: data.name,
        latitude: data.latitude,
        longitude: data.longitude,
      });
      await heartbeat();
    },
  });

  io.attach(server);

  io.on('connection', async (socket) => {
    const token = socket.handshake.auth?.token;
    let displayName = null;

    if (token) {
      const decoded = await verifyToken(token);
      if (decoded) {
        try {
          const r = await fetch(`${AUTH_API}/oauth/userinfo`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const info = await r.json();
          displayName = info.name || info.email?.split('@')[0] || null;
        } catch {}
      }
    }

    socket.displayName = displayName;
    console.log(`[Socket:${socket.id}] connected as ${displayName ?? 'guest'}`);

    socket.on('client:location:update', async ({ latitude, longitude }) => {
      await kafkaProducer.send({
        topic: 'location-updates',
        messages: [{
          key: socket.id,
          value: JSON.stringify({
            id: socket.id,
            name: socket.displayName,
            latitude,
            longitude,
          }),
        }],
      });
    });
  });

  app.get('/config', (req, res) => {
    res.json({ clientId: CLIENT_ID });
  });

  app.use(express.static(path.resolve('./public')));

  // OAuth redirect lands here — serve the SPA so JS can pick up ?code=
  app.get('/auth/callback', (req, res) => {
    res.sendFile(path.resolve('./public/index.html'));
  });

  app.get('/health', (req, res) => res.json({ healthy: true }));

  server.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`),
  );
}

main();

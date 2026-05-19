import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import apiRouter from './api/router.js';
import { getDb } from './db/index.js';
import { startScheduler } from './monitor/scheduler.js';
import { startMaintenance } from './maintenance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000');

// Ensure data directory exists
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'oneresponse.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }));

// API routes
app.use('/api/v1', apiRouter);

// Serve frontend in production
const clientDir = path.join(__dirname, '../client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

// Initialize database
getDb();

// Start server
app.listen(PORT, () => {
  console.log(`oneresponse server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/v1/health`);

  // Start monitoring scheduler
  startScheduler();

  // Start background maintenance (stats refresh + retention)
  startMaintenance();
});

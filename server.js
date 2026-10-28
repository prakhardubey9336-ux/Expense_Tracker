/**
 * server.js — SmartSpend entry point
 * ---------------------------------------------------------------------------
 *  1. Opens/creates the SQLite database (see database.js).
 *  2. Starts an Express server that serves the frontend from /public.
 *  3. Exposes the JSON REST API under /api.
 *
 * Run with:  npm start      (then open http://localhost:3000)
 * Stop with: Ctrl + C in the terminal
 * ---------------------------------------------------------------------------
 */

const path = require('path');
const express = require('express');
const { DB_PATH } = require('./database');
const apiRoutes = require('./src/routes/api');
const { ApiError } = require('./src/validation');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// --- CORS ------------------------------------------------------------------
// The app normally runs same-origin (page and API on http://localhost:3000), so
// nothing here is needed for ordinary use. It IS needed when the page is shown
// inside a sandboxed iframe (some editors and preview panes do this): such a
// frame has an opaque origin, the browser sends `Origin: null`, and without an
// Access-Control-Allow-Origin header every /api call is blocked — the dashboard
// then shows "Cannot reach the SmartSpend server" although the server is fine.
// There are no cookies or credentials in this project, so `*` grants nothing
// that `curl localhost:3000/api/...` could not already do (see README §18).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workspace-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// --- Global middleware -----------------------------------------------------
app.disable('x-powered-by'); // small security nicety: don't advertise Express
app.use(express.json({ limit: '100kb' })); // parse JSON request bodies
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Simple request log so beginners can watch the API calls in the terminal.
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const started = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
    });
  }
  next();
});

// --- Static frontend -------------------------------------------------------
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: '1h',
  })
);

// --- REST API --------------------------------------------------------------
app.use('/api', apiRoutes);

// --- 404 for anything else -------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: { message: 'Not found.' } });
  }
  // Unknown page -> send the single-page app shell.
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Centralised error handler --------------------------------------------
// Express recognises this as an error handler because it has 4 arguments.
// Every thrown/forwarded error ends up here, so the browser always receives
// clean JSON — never a stack trace.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON in request body.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body is too large.' } });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { message: err.message, ...(err.details ? { fields: err.details } : {}) },
    });
  }

  // Unexpected error: log it on the server, show a generic message to users.
  console.error('[SmartSpend] Unexpected error:', err);
  return res.status(500).json({
    error: { message: 'Something went wrong on the server. Please try again.' },
  });
});

// --- Start listening -------------------------------------------------------
// Only listen when this file is run directly (`node server.js`). The test
// script requires this module and starts the server on a random free port.
function start(port = PORT) {
  return app.listen(port, HOST, () => {
    const actualPort = port === 0 ? undefined : port;
    console.log('');
    console.log('  SmartSpend — Your money, clearly organised.');
    console.log('  ------------------------------------------------');
    console.log(`  Database : ${DB_PATH}`);
    if (actualPort) console.log(`  Server   : http://localhost:${actualPort}`);
    console.log('  Stop     : press Ctrl + C in this terminal');
    console.log('');
  });
}

let server = null;
if (require.main === module) {
  server = start(PORT);

  // Graceful shutdown so the SQLite file is closed cleanly on Ctrl + C.
  process.on('SIGINT', () => {
    console.log('\nShutting down SmartSpend...');
    server.close(() => process.exit(0));
  });
}

// Export for the automated tests.
module.exports = { app, start, PORT };

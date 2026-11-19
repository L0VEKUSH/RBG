require('express-async-errors'); // must be first — patches all async routes
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');

const { PORT, MONGO_URI, NODE_ENV, CORS_ORIGIN, TRUST_PROXY_HOPS } = require('./config/env');
const { assertDeclaredIndexesPresent } = require('./utils/mongoose-index-policy');
const { assertProductionDatabaseReady } = require('./utils/production-database-readiness');
const { loadProductionModels } = require('./utils/production-model-inventory');
const { configureMongooseForEnvironment } = require('./utils/mongoose-connection-options');
const {
  closeRedis, connectRedis, hasRedis, sendRedisCommand,
} = require('./config/redis');
const {
  closeHttpServer,
  createGracefulShutdown,
  registerShutdownSignalHandlers,
} = require('./utils/graceful-shutdown');
const { protectOrigin } = require('./middleware/origin-protection.middleware');
const { errorHandler, notFound } = require('./middleware/error.middleware');
const healthRoutes = require('./routes/health.routes');
const { setShutdownRequested, setStartupReady } = require('./services/health.service');

const app = express();
app.set('trust proxy', TRUST_PROXY_HOPS);
const mongooseConnectionOptions = configureMongooseForEnvironment(mongoose, NODE_ENV);
let productionStartupReady = NODE_ENV !== 'production';
let server;
let shutdownRequested = false;

app.use((req, res, next) => {
  if (
    NODE_ENV !== 'production' ||
    productionStartupReady ||
    req.path === '/health' ||
    req.path.startsWith('/health/') ||
    req.path.startsWith('/api/v1/health')
  ) {
    return next();
  }
  return res.status(503).json({
    success: false,
    message: 'The service is completing its startup checks. Please retry shortly.',
  });
});

// Connect to database
mongoose.connect(MONGO_URI, mongooseConnectionOptions)
  .then(async () => {
    if (shutdownRequested) return;
    if (NODE_ENV === 'production') {
      const productionModels = loadProductionModels(mongoose);
      await assertProductionDatabaseReady({
        models: productionModels,
        database: mongoose.connection.db,
        indexCheck: assertDeclaredIndexesPresent,
      });
      if (shutdownRequested) return;
      await connectRedis();
      if (shutdownRequested) return;
    }
    console.log('MongoDB connected');
    productionStartupReady = true;
    setStartupReady(true);
    if (NODE_ENV === 'production' && !shutdownRequested) startHttpServer();
  })
  .catch(err => {
    if (shutdownRequested) return;
    const safeCode = err && typeof err.safeCode === 'string' ? err.safeCode : null;
    const missing = err && Array.isArray(err.missingCollections)
      ? ` missing=${err.missingCollections.join(',')}`
      : '';
    console.error(`Backend startup failed: ${safeCode || (err && err.name) || 'StartupError'}${missing}`);
    process.exit(1);
  });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const corsOrigin = CORS_ORIGIN.split(',');
app.use(cors({ 
  origin: corsOrigin, 
  credentials: true 
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https://*"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false // Allows loading external images/fonts
}));
app.use(mongoSanitize());
app.use(protectOrigin);

const limiterOptions = {
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || (process.env.NODE_ENV === 'test' ? 10000 : 500),
  passOnStoreError: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
  }),
};
if (hasRedis) {
  limiterOptions.store = new RedisStore({
    prefix: `${process.env.RATE_LIMIT_KEY_PREFIX || 'erp-api-global-'}global:`,
    sendCommand: sendRedisCommand,
  });
}
const limiterInstance = rateLimit(limiterOptions);
const limiter = async (req, res, next) => {
  let middlewareError;
  try {
    await limiterInstance(req, res, (error) => {
      middlewareError = error;
      if (!error) next();
    });
    if (middlewareError) throw middlewareError;
  } catch (error) {
    res.status(503).json({
      success: false,
      message: 'This security service is temporarily unavailable. Please try again later.',
    });
  }
};
app.use('/api', limiter);

// Static folder (public UI assets only — no private uploads)
app.use(express.static(path.join(__dirname, 'public')));
// Authenticated upload route mount for backward compatibility with legacy /uploads paths:
app.use('/uploads', require('./routes/upload.routes'));

// ── Health, readiness & liveness endpoints ──────────────────────────────────
app.use('/health', healthRoutes);

// Dynamic route loading
const routesDir = path.join(__dirname, 'routes');
fs.readdirSync(routesDir).forEach(file => {
  if (file.endsWith('.routes.js')) {
    const routeName = file.split('.')[0];
    const route = require('./routes/' + file);

    // Explicit path mapping (singular file name → API plural path)
    const pathMap = {
      auth:         'auth',
      dashboard:    'dashboard',
      timetable:    'timetable',
      cms:          'cms',
      faculty:      'faculty',
      library:      'library',
      transport:    'transport',
      attendance:   'attendance',
      class:        'classes',
      leave:        'leaves',
      notice:       'notices',
      fee:          'fees',
      marks:        'marks',
      homework:     'homework',
      exam:         'exams',
      report:       'reports',
      subject:      'subjects',
      notification: 'notifications',
      message:      'messages',
      admission:    'admissions',
      auditlog:     'audit-logs',
      setting:      'settings',
      settings:     'settings',
      rollover:     'academic-years/rollover',
      event:        'events',
      parent:       'parents',
      upload:       'uploads',
      health:       'health',
      'subject-allocation': 'subject-allocations',
    };

    const pathName = pathMap[routeName] || routeName + 's';


    app.use('/api/v1/' + pathName, route);
  }
});

// Fallback: serve SPA index for non-API paths
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

// Centralised error handling (must be last)
app.use(notFound);
app.use(errorHandler);

function startHttpServer() {
  server = app.listen(PORT, () => {
    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
  });
}

if (NODE_ENV !== 'production') startHttpServer();

// ── Graceful shutdown helper ─────────────────────────────────────────────────
const shutdown = createGracefulShutdown({
  closeHttp: () => closeHttpServer(server),
  closeRedis,
  disconnectMongo: () => mongoose.disconnect(),
  exit: code => process.exit(code),
  log: message => console.error(`[Shutdown] ${message}`),
});
const gracefulShutdown = (reason, exitCode = 1) => {
  shutdownRequested = true;
  productionStartupReady = false;
  setShutdownRequested(true);
  setStartupReady(false);
  return shutdown(reason, exitCode);
};

registerShutdownSignalHandlers(process, gracefulShutdown);

// Unhandled promise rejections: log and shut down — do NOT continue serving.
process.on('unhandledRejection', (err) => {
  console.error(`[UnhandledRejection] ${err && err.message}`);
  gracefulShutdown('Unhandled Promise Rejection');
});

// Uncaught exceptions: the process state is undefined — always shut down.
process.on('uncaughtException', (err) => {
  console.error(`[UncaughtException] ${err && err.message}`);
  console.error(err && err.stack);
  gracefulShutdown('Uncaught Exception');
});

module.exports = app;

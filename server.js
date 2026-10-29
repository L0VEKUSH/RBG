require('express-async-errors'); // must be first — patches all async routes
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');

const { PORT, MONGO_URI, NODE_ENV } = require('./config/env');
const { errorHandler, notFound } = require('./middleware/error.middleware');

const app = express();

// Connect to database
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : 'http://localhost:5000';
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

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100
});
app.use('/api', limiter);

// Static folder
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
      event:        'events',
      parent:       'parents',
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

const server = app.listen(PORT, () => {
  console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
});

// Log unhandled rejections — do NOT crash the server
process.on('unhandledRejection', (err) => {
  console.error(`[UnhandledRejection] ${err && err.message}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[UncaughtException] ${err && err.message}`);
  console.error(err && err.stack);
});

module.exports = app;

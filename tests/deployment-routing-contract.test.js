'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(fullPath)
      : entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

test('browser API helpers use same-origin paths rather than fixed backend hosts', () => {
  const portalCore = read('public/js/portal-core.js');
  const login = read('public/js/login.js');
  const app = read('public/js/app.js');
  const website = read('public/js/website.js');
  const publicPages = read('public/js/public-pages.js');

  assert.match(portalCore, /const API\s*=\s*['"]\/api\/v1['"]/);
  assert.match(login, /const API\s*=\s*['"]\/api\/v1['"]/);
  for (const source of [app, website]) {
    assert.match(source, /const API_BASE\s*=\s*window\.location\.origin\s*\+\s*['"]\/api\/v1['"]/);
  }
  assert.match(publicPages, /fetch\(API_BASE\s*\+\s*['"]\/notices['"]\)/);

  const browserScripts = listJavaScriptFiles(path.join(root, 'public/js'));
  for (const file of browserScripts) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:API|API_BASE)\s*=\s*['"]https?:\/\//, path.relative(root, file));
    assert.doesNotMatch(source, /fetch\s*\(\s*['"]https?:\/\//, path.relative(root, file));
  }
});

test('backend health is a separate exact path from the API proxy scope', () => {
  const adminPortal = read('public/js/admin-portal.js');
  const deploymentGuide = read('docs/vercel-render-routing.md');

  assert.match(adminPortal, /fetch\(['"]\/health['"]/);
  assert.match(deploymentGuide, /"source": "\/api\/v1\/:path\*"/);
  assert.match(deploymentGuide, /"source": "\/health"/);
  assert.doesNotMatch(deploymentGuide, /"source": "\/:path\*"/);
  assert.match(deploymentGuide, /<ACTUAL_RENDER_SERVICE_HOST>/);
});

test('auth keeps the HTTP-only Strict cookie and production Secure flag', () => {
  const tokenSource = read('utils/generateToken.js');
  const logoutSource = read('controllers/auth.controller.js');
  const authMiddleware = read('middleware/auth.middleware.js');

  assert.match(tokenSource, /httpOnly:\s*true/);
  assert.match(tokenSource, /secure:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
  assert.match(tokenSource, /sameSite:\s*['"]strict['"]/);
  assert.match(logoutSource, /httpOnly:\s*true/);
  assert.match(logoutSource, /sameSite:\s*['"]strict['"]/);
  assert.match(authMiddleware, /Authentication is intentionally cookie-only/);
});

test('activation and recovery links use the configured public frontend URL', () => {
  const authService = read('services/auth.service.js');
  const env = read('config/env.js');

  assert.match(authService, /process\.env\.FRONTEND_URL\s*\|\|\s*process\.env\.SCHOOL_WEBSITE/);
  assert.match(authService, /portal\/activate\.html/);
  assert.match(authService, /portal\/reset-password\.html/);
  assert.match(authService, /parsedUrl\.protocol\s*!==\s*['"]https:['"]/);
  assert.match(env, /FRONTEND_URL:\s*process\.env\.FRONTEND_URL\s*\|\|\s*process\.env\.SCHOOL_WEBSITE/);
});

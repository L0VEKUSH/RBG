#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const failures = [];
const warnings = [];
const counts = {
  files: 0,
  externalScripts: 0,
  inlineHandlers: 0,
  inlineStyles: 0,
  inlineScriptBlocks: 0,
  inlineStyleBlocks: 0,
  javascriptUrls: 0,
  stylePropertyWrites: 0,
  controls: 0,
  labels: 0,
  autocompleteIssues: 0,
  labelIssues: 0,
  unnamedButtons: 0
};

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') walk(file);
    } else if (/\.(?:html|js)$/i.test(entry.name)) {
      inspect(file);
    }
  }
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function report(file, source, index, message, warning = false) {
  const row = `${path.relative(root, file)}:${lineAt(source, index)}: ${message}`;
  (warning ? warnings : failures).push(row);
}

function attributes(text) {
  const result = {};
  const regex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(text))) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return result;
}

function inferAutocomplete(attrs) {
  const type = (attrs.type || 'text').toLowerCase();
  const identity = `${attrs.id || ''} ${attrs.name || ''} ${attrs.placeholder || ''}`.toLowerCase();
  if (attrs.autocomplete) return null;
  if (/\b(search|filter|query)\b/.test(identity) || type === 'search') return null;
  if (type === 'password') return /new|confirm|reset|change/.test(identity) ? 'new-password' : 'current-password';
  if (type === 'email' || /\bemail\b/.test(identity)) return /(^|\s)(login|username|user name)(\s|$)/.test(identity) || attrs.id === 'email' ? 'username' : 'email';
  if (type === 'tel' || /\b(phone|mobile|telephone|tel)\b/.test(identity)) return 'tel';
  if (/\b(given.?name|first.?name)\b/.test(identity)) return 'given-name';
  if (/\b(family.?name|last.?name|surname)\b/.test(identity)) return 'family-name';
  if (/\b(name|studentname|parentname|guardianname)\b/.test(identity)) return 'name';
  if (/\b(street.?address|address|addressline)\b/.test(identity)) return 'street-address';
  if (/\b(city|town)\b/.test(identity)) return 'address-level2';
  if (/\b(postal.?code|zip.?code|postcode)\b/.test(identity)) return 'postal-code';
  if (/\busername\b/.test(identity)) return 'username';
  return null;
}

function inspectMarkup(file, source) {
  const tags = [];
  const token = /<([a-z][\w:-]*)\b([^<>]*?)>/gi;
  let match;
  while ((match = token.exec(source))) {
    const name = match[1].toLowerCase();
    tags.push({ name, attrs: attributes(match[2]), index: match.index, end: token.lastIndex, raw: match[0] });
    if (/^on[a-z]+\s*=/.test(match[2].trim()) || /\bon[a-z]+\s*=/.test(match[2])) {
      counts.inlineHandlers++;
      report(file, source, match.index, 'inline event-handler attribute remains');
    }
    if (/\bstyle\s*=/.test(match[2])) {
      counts.inlineStyles++;
      report(file, source, match.index, 'style attribute remains');
    }
    if (/\b(?:href|src)\s*=\s*(["'])\s*javascript\s*:/i.test(match[2])) {
      counts.javascriptUrls++;
      report(file, source, match.index, 'javascript: URL remains');
    }
  }

  const idCounts = new Map();
  for (const tag of tags) {
    if (tag.attrs.id) idCounts.set(tag.attrs.id, (idCounts.get(tag.attrs.id) || 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) report(file, source, tags.find(tag => tag.attrs.id === id).index, `duplicate id "${id}"`);
  }

  const controls = tags.filter(tag => ['input', 'select', 'textarea'].includes(tag.name));
  counts.controls += controls.length;
  const labelTags = [];
  const labelRegex = /<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi;
  while ((match = labelRegex.exec(source))) {
    counts.labels++;
    labelTags.push({ attrs: attributes(match[1]), body: match[2], index: match.index });
  }
  const linkedIds = new Set(labelTags.map(label => label.attrs.for).filter(Boolean));
  const nestedControls = new Set();
  for (const label of labelTags) {
    if (label.attrs.for) {
      const target = tags.find(tag => tag.attrs.id === label.attrs.for);
      if (!target || !['input', 'select', 'textarea'].includes(target.name) || idCounts.get(label.attrs.for) !== 1) {
        counts.labelIssues++;
        report(file, source, label.index, `label target "${label.attrs.for}" must identify one form control`);
      }
    } else {
      const labelOpenEnd = source.indexOf('>', label.index) + 1;
      const labelCloseStart = source.indexOf('</label', labelOpenEnd);
      const contained = controls.filter(control => control.index >= labelOpenEnd && control.index < labelCloseStart);
      if (contained.length === 1) {
        nestedControls.add(contained[0].index);
      } else {
        counts.labelIssues++;
        report(file, source, label.index, 'label without for must wrap exactly one form control');
      }
    }
  }

  for (const control of controls) {
    const expected = inferAutocomplete({ ...control.attrs, type: control.attrs.type || control.name });
    if (expected) {
      counts.autocompleteIssues++;
      report(file, source, control.index, `autofill field should declare autocomplete="${expected}"`);
    }
    const labelled = (control.attrs.id && linkedIds.has(control.attrs.id)) || nestedControls.has(control.index) || control.attrs['aria-label'] || control.attrs['aria-labelledby'];
    if (!labelled) {
      counts.labelIssues++;
      report(file, source, control.index, 'form control has no associated label or accessible name');
    }
  }

  const buttons = tags.filter(tag => tag.name === 'button');
  for (const button of buttons) {
    const close = source.indexOf('</button', button.end);
    if (close < 0) continue;
    const body = source.slice(button.end, close).replace(/<[^>]*>/g, ' ').replace(/\$\{[^}]*\}/g, ' ').trim();
    if (!body && !button.attrs['aria-label']) {
      counts.unnamedButtons++;
      report(file, source, button.index, 'icon-only button needs an aria-label', true);
    }
  }
}

function inspect(file) {
  counts.files++;
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.html')) {
    const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match;
    while ((match = scripts.exec(source))) {
      if (/\bsrc\s*=/i.test(match[1])) counts.externalScripts++;
      else if (match[2].trim()) {
        counts.inlineScriptBlocks++;
        report(file, source, match.index, 'executable inline script remains');
      }
    }
    const styles = /<style\b[^>]*>/gi;
    while ((match = styles.exec(source))) {
      counts.inlineStyleBlocks++;
      report(file, source, match.index, 'style block remains');
    }
    inspectMarkup(file, source);
  } else {
    inspectMarkup(file, source);
    const writes = /(?:\b[A-Za-z_$][\w$]*\.)+style\s*(?:\.\w+|\[[^\]]+\])\s*=/g;
    let match;
    while ((match = writes.exec(source))) {
      counts.stylePropertyWrites++;
      report(file, source, match.index, 'direct style property assignment remains');
    }
    const styleAttributeApi = /\.setAttribute\(\s*['"]style['"]/gi;
    while ((match = styleAttributeApi.exec(source))) report(file, source, match.index, 'dynamic style attribute injection remains');
  }
}

walk(publicRoot);

const serverFile = path.join(root, 'server.js');
const server = fs.readFileSync(serverFile, 'utf8');
if (!/contentSecurityPolicy\s*:\s*\{/.test(server)) failures.push('server.js: Helmet Content Security Policy configuration not found');
if (/unsafe-inline|unsafe-eval/i.test(server)) failures.push('server.js: unsafe-inline/unsafe-eval remains in the CSP configuration');
if (!/scriptSrc\s*:\s*\[\s*["']'self'["']\s*\]/.test(server)) failures.push('server.js: script-src must be restricted to self');
if (!/styleSrc\s*:\s*\[\s*["']'self'["']/.test(server)) failures.push('server.js: style-src must include self');

console.log(`Frontend audit: ${counts.files} source files, ${counts.externalScripts} external script tags, ${counts.controls} controls, ${counts.labels} labels.`);
console.log(`CSP findings: ${counts.inlineHandlers} handlers, ${counts.inlineScriptsRemoved || counts.inlineScriptBlocks} inline scripts, ${counts.inlineStyles} style attributes, ${counts.inlineStyleBlocks} style blocks, ${counts.javascriptUrls} javascript: URLs, ${counts.stylePropertyWrites} style property writes.`);
console.log(`Accessibility findings: ${counts.autocompleteIssues} autocomplete issues, ${counts.labelIssues} label/name issues, ${counts.unnamedButtons} icon-only button warnings.`);
if (warnings.length) {
  console.warn('\nWarnings:');
  for (const warning of warnings) console.warn(`- ${warning}`);
}
if (failures.length) {
  console.error('\nAudit failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('CSP and markup hardening checks passed.');
}

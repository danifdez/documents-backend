#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: smoke-release.mjs <backend-staging>');

const manifest = JSON.parse(await readFile(path.join(root, 'component-manifest.json'), 'utf8'));
if (manifest.component !== 'backend') throw new Error('Invalid backend component manifest');
await access(path.join(root, manifest.entrypoint), constants.R_OK);

const migrations = await readdir(path.join(root, 'dist', 'migrations'));
if (!migrations.some((name) => name.endsWith('.js'))) throw new Error('No compiled migrations found');
await access(path.join(root, 'contracts', 'execution', 'v1', 'schema-manifest.json'), constants.R_OK);

const requireFromBundle = createRequire(path.join(root, 'package.json'));
for (const dependency of ['bcrypt', 'sharp']) requireFromBundle(dependency);

process.env.PUPPETEER_CACHE_DIR = path.join(root, 'runtime', 'puppeteer');
const puppeteer = requireFromBundle('puppeteer');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
await browser.close();

console.log(`Verified backend ${manifest.version} for ${manifest.target}`);

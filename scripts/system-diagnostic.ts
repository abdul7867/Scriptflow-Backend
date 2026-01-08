/**
 * System Diagnostic Script
 * 
 * Checks all system dependencies and configurations
 * Run with: npx ts-node scripts/system-diagnostic.ts
 */

import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import axios from 'axios';

console.log('🔍 ScriptFlow System Diagnostic\n');
console.log('================================\n');

// Check 1: Environment Configuration
console.log('1️⃣  Checking Environment Configuration...');
console.log(`   NODE_ENV: ${config.NODE_ENV}`);
console.log(`   PORT: ${config.PORT}`);
console.log(`   GCP_PROJECT_ID: ${config.GCP_PROJECT_ID}`);
console.log(`   GCP_LOCATION: ${config.GCP_LOCATION}`);

// Check 2: GCP Service Account
console.log('\n2️⃣  Checking GCP Service Account...');
const gcpCredsPath = path.resolve(config.GOOGLE_APPLICATION_CREDENTIALS);
if (fs.existsSync(gcpCredsPath)) {
  const stats = fs.statSync(gcpCredsPath);
  console.log(`   ✅ Service account file found: ${gcpCredsPath}`);
  console.log(`   📊 File size: ${stats.size} bytes`);
  
  try {
    const creds = JSON.parse(fs.readFileSync(gcpCredsPath, 'utf-8'));
    console.log(`   📧 Service account email: ${creds.client_email}`);
    console.log(`   🆔 Project ID: ${creds.project_id}`);
  } catch (e: any) {
    console.log(`   ❌ Failed to parse JSON: ${e.message}`);
  }
} else {
  console.log(`   ❌ Service account file NOT FOUND: ${gcpCredsPath}`);
  console.log(`   ⚠️  Vertex AI will fail without credentials!`);
}

// Check 3: Instagram Cookies
console.log('\n3️⃣  Checking Instagram Cookies...');
const cookiesPath = path.resolve(config.INSTAGRAM_COOKIES_PATH);
console.log(`   Path: ${cookiesPath}`);
if (fs.existsSync(cookiesPath)) {
  const stats = fs.statSync(cookiesPath);
  console.log(`   ✅ Cookies file found: ${stats.size} bytes`);
  
  const content = fs.readFileSync(cookiesPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  console.log(`   📊 Cookie entries: ${lines.length}`);
  
  // Check if cookies are expired
  const sessionIdLine = lines.find(l => l.includes('sessionid'));
  if (sessionIdLine) {
    const parts = sessionIdLine.split('\t');
    const expiry = parseInt(parts[4] || '0');
    const expiryDate = new Date(expiry * 1000);
    const now = new Date();
    
    if (expiry === 0) {
      console.log(`   ⚠️  Session cookie (no expiry)`);
    } else if (expiryDate > now) {
      console.log(`   ✅ Cookies valid until: ${expiryDate.toLocaleDateString()}`);
    } else {
      console.log(`   ❌ Cookies EXPIRED on: ${expiryDate.toLocaleDateString()}`);
      console.log(`   ⚠️  Instagram downloads will fail! Please refresh cookies.`);
    }
  }
} else {
  console.log(`   ❌ Cookies file NOT FOUND`);
  console.log(`   ⚠️  Instagram downloads may fail for private/age-restricted content`);
}

// Check 4: MongoDB Connection
console.log('\n4️⃣  Checking MongoDB Connection...');
console.log(`   URI: ${config.MONGODB_URI.replace(/:[^:@]+@/, ':****@')}`);
try {
  const urlObj = new URL(config.MONGODB_URI);
  console.log(`   Host: ${urlObj.hostname}`);
  console.log(`   Database: ${urlObj.pathname.slice(1)}`);
  console.log(`   ✅ URI format valid`);
} catch (e) {
  console.log(`   ❌ Invalid MongoDB URI format`);
}

// Check 5: Redis Connection
console.log('\n5️⃣  Checking Redis Connection...');
console.log(`   URI: ${config.REDIS_URL.replace(/:[^:@]+@/, ':****@')}`);
try {
  const urlObj = new URL(config.REDIS_URL);
  console.log(`   Host: ${urlObj.hostname}`);
  console.log(`   Port: ${urlObj.port || '6379'}`);
  console.log(`   ✅ URI format valid`);
} catch (e) {
  console.log(`   ❌ Invalid Redis URI format`);
}

// Check 6: ManyChat Configuration
console.log('\n6️⃣  Checking ManyChat Configuration...');
if (config.MANYCHAT_API_KEY && config.MANYCHAT_API_KEY.length > 10) {
  console.log(`   ✅ API Key configured (${config.MANYCHAT_API_KEY.substring(0, 10)}...)`);
  console.log(`   📋 Script Field ID: ${config.MANYCHAT_SCRIPT_FIELD_ID}`);
  console.log(`   📋 Copy Field ID: ${config.MANYCHAT_COPY_FIELD_ID}`);
} else {
  console.log(`   ❌ ManyChat API Key not configured`);
  console.log(`   ⚠️  Webhook responses will fail!`);
}

// Check 7: ImgBB Configuration
console.log('\n7️⃣  Checking ImgBB Configuration...');
if (config.IMGBB_API_KEY && config.IMGBB_API_KEY.length > 10) {
  console.log(`   ✅ API Key configured (${config.IMGBB_API_KEY.substring(0, 10)}...)`);
} else {
  console.log(`   ❌ ImgBB API Key not configured`);
  console.log(`   ⚠️  Image uploads will fail!`);
}

// Check 8: Temp Directory
console.log('\n8️⃣  Checking Temp Directory...');
const tempDir = path.join(process.cwd(), 'temp');
if (fs.existsSync(tempDir)) {
  console.log(`   ✅ Temp directory exists: ${tempDir}`);
  const files = fs.readdirSync(tempDir);
  console.log(`   📊 Files in temp: ${files.length}`);
  
  if (files.length > 50) {
    console.log(`   ⚠️  Warning: Many temp files (${files.length}). Consider cleanup.`);
  }
} else {
  console.log(`   ⚠️  Temp directory doesn't exist (will be created on startup)`);
}

// Check 9: yt-dlp availability
console.log('\n9️⃣  Checking yt-dlp (for Instagram downloads)...');
const { execSync } = require('child_process');
try {
  const result = execSync('where yt-dlp', { encoding: 'utf-8', stdio: 'pipe' });
  console.log(`   ✅ yt-dlp found in PATH: ${result.trim()}`);
} catch (e) {
  console.log(`   ⚠️  yt-dlp not found in system PATH`);
  console.log(`   ℹ️  Using yt-dlp-exec (bundled) - this should work fine`);
  console.log(`   ℹ️  Direct CDN extraction will be used as primary method`);
}

// Check 10: FFmpeg availability
console.log('\n🔟 Checking FFmpeg (for video processing)...');
try {
  const ffmpegPath = require('ffmpeg-static');
  if (fs.existsSync(ffmpegPath)) {
    console.log(`   ✅ FFmpeg (static) found: ${ffmpegPath}`);
  } else {
    console.log(`   ❌ FFmpeg static binary not found`);
  }
} catch (e) {
  console.log(`   ❌ FFmpeg not available: ${e}`);
}

// Summary
console.log('\n================================');
console.log('📊 DIAGNOSTIC SUMMARY\n');
console.log('Run the server with: npm run dev');
console.log('Monitor logs for any connection errors.');
console.log('\nIf you see errors:');
console.log('  - Check MongoDB/Redis URLs');
console.log('  - Verify GCP service account credentials');
console.log('  - Refresh Instagram cookies if expired');
console.log('  - Ensure ManyChat/ImgBB API keys are valid');
console.log('\n✅ Diagnostic complete!\n');

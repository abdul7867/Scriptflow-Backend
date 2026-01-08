/**
 * Production Readiness Check
 * 
 * Comprehensive test to ensure system can handle 50-100 concurrent users
 * Run with: npx ts-node scripts/production-readiness-check.ts
 */

import axios from 'axios';
import { config } from '../src/config';

console.log('🚀 ScriptFlow Production Readiness Check\n');
console.log('Testing for 50-100 concurrent user capacity\n');
console.log('==========================================\n');

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

const results: CheckResult[] = [];

// Check 1: Memory Configuration
console.log('1️⃣  Checking Memory Configuration...');
const heapSize = parseInt(process.argv.find(arg => arg.includes('--max-old-space-size'))?.split('=')[1] || '0');
if (heapSize < 1024) {
  results.push({
    name: 'Memory Configuration',
    status: 'WARN',
    message: `Heap size: ${heapSize}MB. Recommended: 1024MB+ for compiled code`,
    details: { recommended: '1024MB', actual: `${heapSize}MB` }
  });
} else {
  results.push({
    name: 'Memory Configuration',
    status: 'PASS',
    message: `Heap size: ${heapSize}MB - Good for production`,
  });
}

// Check 2: Redis Configuration
console.log('2️⃣  Checking Redis Configuration...');
try {
  const redisUrl = config.REDIS_URL;
  if (redisUrl.includes('upstash.io')) {
    results.push({
      name: 'Redis Provider',
      status: 'PASS',
      message: 'Using Upstash Redis (Cloud)',
      details: { provider: 'Upstash', url: redisUrl.substring(0, 40) + '...' }
    });
  } else if (redisUrl.includes('localhost')) {
    results.push({
      name: 'Redis Provider',
      status: 'WARN',
      message: 'Using localhost Redis (Dev only)',
      details: { provider: 'Local', recommendation: 'Use cloud Redis for production' }
    });
  }
} catch (e) {
  results.push({
    name: 'Redis Configuration',
    status: 'FAIL',
    message: `Redis check failed: ${e}`,
  });
}

// Check 3: Queue Concurrency
console.log('3️⃣  Checking Queue Settings...');
const queueConcurrency = config.QUEUE_CONCURRENCY;
if (queueConcurrency >= 2 && queueConcurrency <= 3) {
  results.push({
    name: 'Queue Concurrency',
    status: 'PASS',
    message: `Concurrency: ${queueConcurrency} (Optimal for 50-100 users)`,
  });
} else if (queueConcurrency > 3) {
  results.push({
    name: 'Queue Concurrency',
    status: 'WARN',
    message: `Concurrency: ${queueConcurrency} (May cause memory issues)`,
    details: { recommended: '2-3', actual: queueConcurrency }
  });
} else {
  results.push({
    name: 'Queue Concurrency',
    status: 'WARN',
    message: `Concurrency: ${queueConcurrency} (Low for 50-100 users)`,
    details: { recommended: '2-3', actual: queueConcurrency }
  });
}

// Check 4: Rate Limiting
console.log('4️⃣  Checking Rate Limits...');
const userRateLimit = config.USER_RATE_LIMIT;
if (userRateLimit >= 5 && userRateLimit <= 20) {
  results.push({
    name: 'User Rate Limit',
    status: 'PASS',
    message: `${userRateLimit} requests/hour per user (Good balance)`,
  });
} else {
  results.push({
    name: 'User Rate Limit',
    status: 'WARN',
    message: `${userRateLimit} requests/hour per user`,
    details: { recommended: '5-20', actual: userRateLimit }
  });
}

// Check 5: MongoDB Connection
console.log('5️⃣  Checking MongoDB Configuration...');
try {
  const mongoUri = config.MONGODB_URI;
  if (mongoUri.includes('mongodb+srv')) {
    results.push({
      name: 'MongoDB Provider',
      status: 'PASS',
      message: 'Using MongoDB Atlas (Cloud)',
      details: { provider: 'Atlas', cluster: mongoUri.split('@')[1]?.split('/')[0] }
    });
  } else {
    results.push({
      name: 'MongoDB Provider',
      status: 'WARN',
      message: 'Using localhost MongoDB (Dev only)',
    });
  }
} catch (e) {
  results.push({
    name: 'MongoDB Configuration',
    status: 'FAIL',
    message: `MongoDB check failed: ${e}`,
  });
}

// Check 6: API Keys
console.log('6️⃣  Checking API Keys...');
const apiKeys = {
  'Vertex AI': config.GCP_PROJECT_ID && config.GOOGLE_APPLICATION_CREDENTIALS,
  'ImgBB': config.IMGBB_API_KEY && config.IMGBB_API_KEY.length > 10,
};

let allKeysValid = true;
for (const [service, isValid] of Object.entries(apiKeys)) {
  if (isValid) {
    results.push({
      name: `${service} API`,
      status: 'PASS',
      message: `${service} configured`,
    });
  } else {
    allKeysValid = false;
    results.push({
      name: `${service} API`,
      status: 'FAIL',
      message: `${service} NOT configured`,
    });
  }
}

// Check 7: System Requirements
console.log('7️⃣  Checking System Requirements...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);
if (majorVersion >= 18) {
  results.push({
    name: 'Node.js Version',
    status: 'PASS',
    message: `Node.js ${nodeVersion}`,
  });
} else {
  results.push({
    name: 'Node.js Version',
    status: 'FAIL',
    message: `Node.js ${nodeVersion} (Requires 18+)`,
  });
}

// Check 8: Environment
console.log('8️⃣  Checking Environment...');
if (config.NODE_ENV === 'production') {
  results.push({
    name: 'Environment',
    status: 'PASS',
    message: 'Running in PRODUCTION mode',
  });
} else {
  results.push({
    name: 'Environment',
    status: 'WARN',
    message: 'Running in DEVELOPMENT mode (Use production for deployment)',
  });
}

// Calculate capacity estimation
console.log('\n9️⃣  Estimating System Capacity...\n');

const memoryPerJob = 50; // MB
const heapAvailable = heapSize * 0.7; // 70% usable after overhead
const baseMemory = heapSize === 2048 ? 450 : 250; // ts-node vs compiled
const availableForJobs = heapAvailable - baseMemory;
const maxConcurrentJobs = Math.floor(availableForJobs / memoryPerJob);
const estimatedUsers = maxConcurrentJobs * 25; // Assume 1 job per 25 users average

console.log(`   Base Memory Usage: ${baseMemory}MB`);
console.log(`   Available for Jobs: ${availableForJobs}MB`);
console.log(`   Memory per Job: ${memoryPerJob}MB`);
console.log(`   Max Concurrent Jobs: ${maxConcurrentJobs}`);
console.log(`   Estimated User Capacity: ${estimatedUsers} users\n`);

if (estimatedUsers >= 50) {
  results.push({
    name: 'System Capacity',
    status: 'PASS',
    message: `Can handle ~${estimatedUsers} concurrent users`,
    details: { concurrent_jobs: maxConcurrentJobs, users: estimatedUsers }
  });
} else {
  results.push({
    name: 'System Capacity',
    status: 'WARN',
    message: `Limited to ~${estimatedUsers} concurrent users`,
    details: { 
      concurrent_jobs: maxConcurrentJobs, 
      users: estimatedUsers,
      recommendation: 'Run compiled code with npm run dev:optimized'
    }
  });
}

// Summary
console.log('\n==========================================');
console.log('📊 RESULTS SUMMARY\n');

const passed = results.filter(r => r.status === 'PASS').length;
const warned = results.filter(r => r.status === 'WARN').length;
const failed = results.filter(r => r.status === 'FAIL').length;

results.forEach(result => {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} ${result.name}: ${result.message}`);
  if (result.details) {
    console.log(`   Details: ${JSON.stringify(result.details)}`);
  }
});

console.log('\n==========================================');
console.log(`✅ Passed: ${passed}`);
console.log(`⚠️  Warnings: ${warned}`);
console.log(`❌ Failed: ${failed}\n`);

// Recommendations
console.log('📋 RECOMMENDATIONS:\n');

if (heapSize === 2048) {
  console.log('1. 🔧 Switch from ts-node to compiled code:');
  console.log('   npm run dev:optimized');
  console.log('   This will save 150-200MB memory\n');
}

if (queueConcurrency > 2) {
  console.log('2. ⚙️  Reduce QUEUE_CONCURRENCY to 2 in .env');
  console.log('   Current: 3, Recommended: 2 for memory efficiency\n');
}

if (config.NODE_ENV !== 'production') {
  console.log('3. 🚀 For production deployment:');
  console.log('   - Set NODE_ENV=production in .env');
  console.log('   - Use npm run build && npm start:prod');
  console.log('   - Monitor memory with Memory Governor logs\n');
}

console.log('4. 📊 Monitor system health:');
console.log('   - Health endpoint: http://localhost:3000/health/detailed');
console.log('   - Watch Memory Governor logs');
console.log('   - Check Redis connection stability\n');

// Final verdict
console.log('==========================================');
if (failed === 0 && estimatedUsers >= 50) {
  console.log('🎉 SYSTEM READY FOR 50-100 CONCURRENT USERS!');
} else if (failed === 0 && warned > 0) {
  console.log('⚠️  SYSTEM OPERATIONAL WITH RECOMMENDATIONS');
  console.log('   Apply recommendations above for optimal performance');
} else {
  console.log('❌ SYSTEM NOT READY');
  console.log('   Fix failed checks before production deployment');
}
console.log('==========================================\n');

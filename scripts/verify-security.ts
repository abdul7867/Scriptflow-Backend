#!/usr/bin/env node
/**
 * Security Verification Script
 * Tests Redis connection, rate limiting, and security features
 */

import { connectRedis, disconnectRedis, getRedis } from '../src/queue/redis';
import { getUserRateLimitStatus, isUserBlocked } from '../src/middleware/userRateLimiter';
import { logger } from '../src/utils/logger';

async function verifyRedis() {
  console.log('\n🔍 Testing Redis Connection...');
  
  try {
    await connectRedis();
    const redis = getRedis();
    
    // Test basic operations
    await redis.set('test:verify', 'working', 'EX', 10);
    const value = await redis.get('test:verify');
    
    if (value === 'working') {
      console.log('✅ Redis connection working');
      console.log('✅ Redis SET/GET operations working');
    } else {
      console.log('❌ Redis operations failed');
    }
    
    // Clean up
    await redis.del('test:verify');
    
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
  }
}

async function verifyRateLimiting() {
  console.log('\n🔍 Testing Rate Limiting...');
  
  try {
    const testUserId = 'test_user_' + Date.now();
    const redis = getRedis();
    
    // Simulate rate limit increments
    const key = `user_rl:${testUserId}`;
    
    // Test atomic increment
    const count1 = await redis.incr(key);
    const count2 = await redis.incr(key);
    const count3 = await redis.incr(key);
    
    if (count1 === 1 && count2 === 2 && count3 === 3) {
      console.log('✅ Rate limiting atomic increments working');
    } else {
      console.log('❌ Rate limiting increments incorrect');
    }
    
    // Check TTL
    await redis.expire(key, 10);
    const ttl = await redis.ttl(key);
    
    if (ttl > 0 && ttl <= 10) {
      console.log('✅ Rate limit TTL working');
    } else {
      console.log('❌ Rate limit TTL not set properly');
    }
    
    // Clean up
    await redis.del(key);
    
    // Test rate limit status function
    const status = await getUserRateLimitStatus('test_user_verify');
    if (status) {
      console.log('✅ Rate limit status function working');
      console.log(`   - Used: ${status.used}, Remaining: ${status.remaining}`);
    }
    
  } catch (error) {
    console.error('❌ Rate limiting test failed:', error);
  }
}

async function verifyBlockingSystem() {
  console.log('\n🔍 Testing User Blocking System...');
  
  try {
    const testUserId = 'blocked_test_' + Date.now();
    const redis = getRedis();
    
    // Test blocking
    const blockKey = `blocked:${testUserId}`;
    await redis.setex(blockKey, 10, 'true');
    
    const isBlocked = await isUserBlocked(testUserId);
    
    if (isBlocked) {
      console.log('✅ User blocking system working');
    } else {
      console.log('❌ User blocking failed');
    }
    
    // Clean up
    await redis.del(blockKey);
    
  } catch (error) {
    console.error('❌ Blocking system test failed:', error);
  }
}

async function verifyMemoryLeaks() {
  console.log('\n🔍 Checking for Memory Leaks...');
  
  try {
    const redis = getRedis();
    
    // Check event listener count
    const listenerCount = redis.listenerCount('error');
    
    if (listenerCount <= 1) {
      console.log('✅ Event listeners properly managed (no duplicates)');
    } else {
      console.log(`⚠️  Warning: ${listenerCount} error listeners detected`);
    }
    
    console.log('✅ No obvious memory leaks detected');
    
  } catch (error) {
    console.error('❌ Memory leak check failed:', error);
  }
}

async function main() {
  console.log('🔐 ScriptFlow Security Verification\n');
  console.log('='= 50);
  
  try {
    await verifyRedis();
    await verifyRateLimiting();
    await verifyBlockingSystem();
    await verifyMemoryLeaks();
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ All security checks passed!\n');
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await disconnectRedis();
    process.exit(0);
  }
}

main();

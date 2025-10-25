/**
 * Validate and display all required environment variables
 * Run this before starting the bot to ensure proper configuration
 */

import { existsSync } from 'fs';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

interface EnvCheck {
  name: string;
  required: boolean;
  description: string;
  example?: string;
}

const envChecks: EnvCheck[] = [
  // Database
  { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string', example: 'postgresql://user:pass@host:5432/dbname' },
  
  // Redis
  { name: 'REDIS_URL', required: false, description: 'Full Redis URL (if set, overrides individual Redis vars)', example: 'redis://host:6379 or rediss://host:6380' },
  { name: 'REDIS_HOST', required: false, description: 'Redis hostname (defaults to localhost)', example: 'localhost or redis.example.com' },
  { name: 'REDIS_PORT', required: false, description: 'Redis port (defaults to 6379)', example: '6379' },
  { name: 'REDIS_PASSWORD', required: false, description: 'Redis password (optional)', example: 'your_redis_password' },
  { name: 'REDIS_TLS', required: false, description: 'Use TLS for Redis (true/false)', example: 'true' },
  
  // Twilio
  { name: 'TWILIO_ACCOUNT_SID', required: true, description: 'Twilio Account SID', example: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  { name: 'TWILIO_AUTH_TOKEN', required: true, description: 'Twilio Auth Token', example: 'your_auth_token' },
  { name: 'TWILIO_WHATSAPP_FROM', required: true, description: 'Twilio WhatsApp sender number', example: 'whatsapp:+14155238886 or +966508034010' },
  
  // Optional Twilio
  { name: 'TWILIO_MASTER_SID', required: false, description: 'Master Twilio Account SID (for multi-tenant)', example: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  { name: 'TWILIO_MASTER_AUTH', required: false, description: 'Master Twilio Auth Token', example: 'your_auth_token' },
  
  // App Configuration
  { name: 'PORT', required: false, description: 'HTTP server port (defaults to 3000)', example: '3000' },
  { name: 'NODE_ENV', required: false, description: 'Environment (development/production)', example: 'production' },
  { name: 'JWT_SECRET', required: true, description: 'JWT secret for authentication', example: 'random_secure_string_here' },
  { name: 'WHATSAPP_SEND_TOKEN', required: false, description: 'API token for WhatsApp send endpoint', example: 'secure_token_here' },
  
  // Optional Features
  { name: 'SUFRAH_API_KEY', required: false, description: 'Sufrah API key (if using external catalog)', example: 'your_api_key' },
  { name: 'DASHBOARD_BASE_URL', required: false, description: 'Dashboard frontend URL', example: 'https://sufrah-bot.vercel.app' },
];

function maskSensitive(value: string, name: string): string {
  const sensitiveKeys = ['PASSWORD', 'TOKEN', 'SECRET', 'KEY', 'AUTH'];
  if (sensitiveKeys.some(key => name.includes(key))) {
    if (value.length <= 4) return '***';
    return value.slice(0, 4) + '***' + value.slice(-4);
  }
  return value;
}

function validateUrl(url: string, name: string): { valid: boolean; error?: string } {
  try {
    if (name === 'DATABASE_URL') {
      if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
        return { valid: false, error: 'Must start with postgresql:// or postgres://' };
      }
    } else if (name.includes('REDIS')) {
      if (!url.startsWith('redis://') && !url.startsWith('rediss://')) {
        return { valid: false, error: 'Must start with redis:// or rediss://' };
      }
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

async function main() {
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║     Environment Variables Validation Report           ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  // Check if .env file exists
  const envPath = '.env';
  if (existsSync(envPath)) {
    console.log(`${colors.green}✓${colors.reset} .env file found`);
  } else {
    console.log(`${colors.yellow}⚠${colors.reset} .env file not found (using environment variables)`);
  }
  console.log('');

  let hasErrors = false;
  let hasWarnings = false;

  for (const check of envChecks) {
    const value = process.env[check.name];
    const isSet = value !== undefined && value !== '';

    if (check.required && !isSet) {
      console.log(`${colors.red}✗ ${check.name}${colors.reset}`);
      console.log(`  ${colors.red}REQUIRED but not set${colors.reset}`);
      console.log(`  ${colors.blue}Description:${colors.reset} ${check.description}`);
      if (check.example) {
        console.log(`  ${colors.blue}Example:${colors.reset} ${check.example}`);
      }
      console.log('');
      hasErrors = true;
    } else if (isSet) {
      const masked = maskSensitive(value!, check.name);
      
      // Validate URLs
      if (check.name.includes('URL') && value) {
        const validation = validateUrl(value, check.name);
        if (!validation.valid) {
          console.log(`${colors.yellow}⚠ ${check.name}${colors.reset}`);
          console.log(`  ${colors.yellow}Set but invalid: ${validation.error}${colors.reset}`);
          console.log(`  ${colors.blue}Current:${colors.reset} ${masked}`);
          console.log(`  ${colors.blue}Example:${colors.reset} ${check.example}`);
          console.log('');
          hasWarnings = true;
        } else {
          console.log(`${colors.green}✓ ${check.name}${colors.reset} = ${masked}`);
        }
      } else {
        console.log(`${colors.green}✓ ${check.name}${colors.reset} = ${masked}`);
      }
    } else if (!check.required) {
      console.log(`${colors.yellow}○ ${check.name}${colors.reset} (optional, not set)`);
    }
  }

  console.log('');
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  
  // Summary
  if (hasErrors) {
    console.log(`${colors.red}✗ VALIDATION FAILED${colors.reset} - Missing required variables`);
    console.log('');
    console.log('Please set the required environment variables in your .env file');
    process.exit(1);
  } else if (hasWarnings) {
    console.log(`${colors.yellow}⚠ VALIDATION PASSED WITH WARNINGS${colors.reset}`);
    console.log('');
    console.log('Some variables are set but may have issues. Please review above.');
  } else {
    console.log(`${colors.green}✓ ALL CHECKS PASSED${colors.reset}`);
    console.log('');
    console.log('Environment is properly configured!');
  }

  // Additional Redis connectivity test
  console.log('');
  console.log(`${colors.cyan}Testing Redis connectivity...${colors.reset}`);
  
  try {
    const { default: Redis } = await import('ioredis');
    const redisUrl = process.env.REDIS_URL;
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = process.env.REDIS_PORT || '6379';
    const redisPassword = process.env.REDIS_PASSWORD || '';
    const redisTls = process.env.REDIS_TLS === 'true';
    
    let connectionUrl: string;
    if (redisUrl && redisUrl.includes('://')) {
      connectionUrl = redisUrl;
    } else {
      const protocol = redisTls ? 'rediss' : 'redis';
      const auth = redisPassword ? `:${encodeURIComponent(redisPassword)}@` : '';
      connectionUrl = `${protocol}://${auth}${redisHost}:${redisPort}`;
    }
    
    console.log(`  Connecting to: ${connectionUrl.replace(/:[^:@]+@/, ':***@')}`);
    
    const redis = new Redis(connectionUrl, {
      lazyConnect: true,
      retryStrategy: () => null, // Don't retry for this test
    });
    
    await redis.connect();
    await redis.ping();
    await redis.quit();
    
    console.log(`${colors.green}✓ Redis connection successful${colors.reset}`);
  } catch (error: any) {
    console.log(`${colors.red}✗ Redis connection failed: ${error.message}${colors.reset}`);
    console.log('');
    console.log('Common Redis issues:');
    console.log('  1. REDIS_HOST is pointing to a non-existent hostname');
    console.log('  2. Redis server is not running');
    console.log('  3. Firewall/network blocking the connection');
    console.log('  4. Wrong port or TLS setting');
    console.log('');
    console.log('Suggested fixes:');
    console.log('  - For local development: Set REDIS_HOST=localhost (or 127.0.0.1)');
    console.log('  - For cloud Redis: Verify REDIS_URL is correct');
    console.log('  - Check if Redis is running: redis-cli ping');
    hasErrors = true;
  }

  // Test database connectivity
  console.log('');
  console.log(`${colors.cyan}Testing database connectivity...${colors.reset}`);
  
  try {
    const { prisma } = await import('../src/db/client');
    await prisma.$connect();
    await prisma.$disconnect();
    console.log(`${colors.green}✓ Database connection successful${colors.reset}`);
  } catch (error: any) {
    console.log(`${colors.red}✗ Database connection failed: ${error.message}${colors.reset}`);
    hasErrors = true;
  }

  console.log('');
  if (hasErrors) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`${colors.red}❌ Validation script error:${colors.reset}`, e);
  process.exit(1);
});


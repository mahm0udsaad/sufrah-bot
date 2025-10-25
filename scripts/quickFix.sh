#!/bin/bash

# Quick fix script for button click issue
# This script will guide you through fixing the environment variables

echo "🔧 WhatsApp Bot - Quick Fix for Button Click Issue"
echo "══════════════════════════════════════════════════════"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "❌ .env file not found!"
  echo "Please create a .env file first"
  exit 1
fi

# Check for JWT_SECRET
if ! grep -q "^JWT_SECRET=" .env; then
  echo "⚠️  JWT_SECRET is missing from .env"
  echo ""
  read -p "Do you want to generate a random JWT_SECRET? (y/n): " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Generate random secret
    JWT_SECRET=$(openssl rand -base64 32)
    echo "" >> .env
    echo "# JWT Secret (auto-generated)" >> .env
    echo "JWT_SECRET=\"$JWT_SECRET\"" >> .env
    echo "✅ JWT_SECRET added to .env"
  else
    echo "Please add JWT_SECRET manually to your .env file"
    echo "Example: JWT_SECRET=\"your_random_secure_string_here\""
  fi
  echo ""
fi

# Check REDIS configuration
echo "🔍 Checking Redis configuration..."
if grep -q "^REDIS_URL=" .env; then
  REDIS_URL=$(grep "^REDIS_URL=" .env | cut -d '=' -f 2- | tr -d '"' | tr -d "'")
  echo "✅ REDIS_URL is set: ${REDIS_URL:0:20}..."
  
  # Check if REDIS_HOST is truncated
  if grep -q "redis-cloud.comp\"" .env; then
    echo "⚠️  Found truncated REDIS_HOST (ends with .comp instead of .com)"
    echo "Since REDIS_URL is set correctly, this won't cause issues."
    echo "But you can fix it if you want."
  fi
else
  echo "⚠️  REDIS_URL is not set"
  echo "Please set REDIS_URL in your .env file"
fi
echo ""

# Validate environment
echo "🔍 Validating all environment variables..."
bun run scripts/validateEnv.ts

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Environment validation failed"
  echo "Please fix the issues above before continuing"
  exit 1
fi

echo ""
echo "✅ Environment validation passed!"
echo ""

# Regenerate Prisma client
echo "📦 Regenerating Prisma client..."
bunx prisma generate > /dev/null 2>&1
echo "✅ Prisma client regenerated"
echo ""

# Check RestaurantBot
echo "🔍 Checking RestaurantBot configuration..."
bun run scripts/checkAndFixBot.ts
echo ""

# Ask about PM2 restart
echo "══════════════════════════════════════════════════════"
echo "🎯 Next Steps:"
echo ""
echo "1. Test locally first:"
echo "   bun run --watch index.ts"
echo ""
echo "2. If local testing works, restart PM2:"
echo "   pm2 restart whatsapp-bot --update-env"
echo "   pm2 restart outbound-worker --update-env"
echo ""
echo "3. Monitor logs:"
echo "   pm2 logs whatsapp-bot --lines 50"
echo ""
echo "4. Test button click in WhatsApp"
echo "   Look for: 🔘 [ButtonClick] and ✅ [ButtonClick] Successfully sent"
echo ""
echo "══════════════════════════════════════════════════════"
echo ""

read -p "Do you want to restart PM2 now? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if command -v pm2 &> /dev/null; then
    echo "🔄 Restarting PM2 processes..."
    pm2 restart whatsapp-bot --update-env
    pm2 restart outbound-worker --update-env 2>/dev/null || echo "  ℹ️  outbound-worker not running"
    echo ""
    echo "✅ PM2 restart complete!"
    echo ""
    echo "📊 Current PM2 status:"
    pm2 list
  else
    echo "❌ PM2 is not installed or not in PATH"
    echo "Please restart your processes manually"
  fi
else
  echo "Skipping PM2 restart. You can do it manually later."
fi

echo ""
echo "✅ Quick fix complete!"
echo ""
echo "📋 Full documentation: FIX_BUTTON_CLICK_ISSUE.md"


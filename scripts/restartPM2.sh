#!/bin/bash

# Script to properly restart PM2 with fresh environment and regenerated Prisma client

echo "🔄 Restarting WhatsApp Bot with PM2..."
echo ""

# Step 1: Regenerate Prisma client
echo "📦 Step 1: Regenerating Prisma client..."
bunx prisma generate
if [ $? -ne 0 ]; then
  echo "❌ Failed to regenerate Prisma client"
  exit 1
fi
echo "✅ Prisma client regenerated"
echo ""

# Step 2: Check database connection
echo "🔌 Step 2: Testing database connection..."
bun run scripts/checkAndFixBot.ts
if [ $? -ne 0 ]; then
  echo "⚠️  Database check failed, but continuing..."
fi
echo ""

# Step 3: Restart PM2 processes
echo "🔄 Step 3: Restarting PM2 processes..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
  echo "❌ PM2 is not installed. Install with: npm install -g pm2"
  exit 1
fi

# Restart whatsapp-bot (main server)
echo "  Restarting whatsapp-bot..."
pm2 restart whatsapp-bot --update-env
if [ $? -ne 0 ]; then
  echo "  ⚠️  whatsapp-bot process not found or failed to restart"
fi

# Restart outbound-worker if it exists
echo "  Restarting outbound-worker..."
pm2 restart outbound-worker --update-env 2>/dev/null || echo "  ℹ️  outbound-worker not running (this is okay)"

echo ""
echo "✅ PM2 restart complete!"
echo ""
echo "📊 Current PM2 status:"
pm2 list
echo ""
echo "📋 To view logs:"
echo "  pm2 logs whatsapp-bot --lines 50"
echo ""
echo "🔍 Look for these log entries to confirm button clicks work:"
echo "  ✓ 📍 Routed to restaurant: rashad (cmgm28wjo0001sa9oqd57vqko)"
echo "  ✓ 🔘 [ButtonClick] User requested \"View Order Details\""
echo "  ✓ ✅ [ButtonClick] Successfully sent cached message"


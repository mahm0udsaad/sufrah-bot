#!/bin/bash

# Test script for new API endpoints
# Replace with your actual values

BASE_URL="https://bot.sufrah.sa"
DASHBOARD_PAT="your_dashboard_pat_token"
RESTAURANT_ID="your_restaurant_id"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Testing New API Endpoints ===${NC}\n"

# Test 1: List all bots (Admin API)
echo -e "${BLUE}Test 1: List All Bots${NC}"
echo "GET $BASE_URL/api/admin/bots"
curl -s -X GET "$BASE_URL/api/admin/bots" | jq '.' || echo -e "${RED}Failed${NC}"
echo -e "\n"

# Test 2: Register new bot (Example - Sufrah)
echo -e "${BLUE}Test 2: Register Sufrah Bot${NC}"
echo "POST $BASE_URL/api/admin/bots"
curl -s -X POST "$BASE_URL/api/admin/bots" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sufrah Bot",
    "restaurantName": "Sufrah",
    "whatsappNumber": "whatsapp:+966508034010",
    "senderSid": "XE23c4f8b55966a1bfd101338f4c68b8cb",
    "wabaId": "777730705047590",
    "accountSid": "YOUR_TWILIO_ACCOUNT_SID",
    "authToken": "YOUR_TWILIO_AUTH_TOKEN",
    "status": "ACTIVE",
    "supportContact": "info@sufrah.sa"
  }' | jq '.' || echo -e "${RED}Failed (maybe already exists?)${NC}"
echo -e "\n"

# Test 3: Get conversations from database
echo -e "${BLUE}Test 3: Get Conversations from Database${NC}"
echo "GET $BASE_URL/api/db/conversations"
curl -s -X GET "$BASE_URL/api/db/conversations?limit=5" \
  -H "Authorization: Bearer $DASHBOARD_PAT" \
  -H "X-Restaurant-Id: $RESTAURANT_ID" | jq '.' || echo -e "${RED}Failed${NC}"
echo -e "\n"

# Test 4: Get conversation stats
echo -e "${BLUE}Test 4: Get Conversation Stats${NC}"
echo "GET $BASE_URL/api/db/conversations/stats"
curl -s -X GET "$BASE_URL/api/db/conversations/stats" \
  -H "Authorization: Bearer $DASHBOARD_PAT" \
  -H "X-Restaurant-Id: $RESTAURANT_ID" | jq '.' || echo -e "${RED}Failed${NC}"
echo -e "\n"

# Test 5: Compare old vs new API
echo -e "${BLUE}Test 5: Compare Old API (in-memory) vs New API (database)${NC}"
echo "Old API (may be empty after restart):"
curl -s -X GET "$BASE_URL/api/conversations" \
  -H "Authorization: Bearer $DASHBOARD_PAT" \
  -H "X-Restaurant-Id: $RESTAURANT_ID" | jq 'length'

echo "New API (always has data):"
curl -s -X GET "$BASE_URL/api/db/conversations" \
  -H "Authorization: Bearer $DASHBOARD_PAT" \
  -H "X-Restaurant-Id: $RESTAURANT_ID" | jq 'length'
echo -e "\n"

echo -e "${GREEN}=== Tests Complete ===${NC}"
echo -e "\nNext steps:"
echo "1. Update the script with your actual credentials"
echo "2. Run: chmod +x docs/TEST_NEW_APIS.sh"
echo "3. Run: ./docs/TEST_NEW_APIS.sh"
echo "4. Verify all endpoints return expected data"


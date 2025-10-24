/**
 * Shared Dashboard Authentication Utility
 * 
 * Provides consistent authentication and restaurant ID resolution
 * for all dashboard API endpoints.
 */

import { DASHBOARD_PAT, BOT_API_KEY } from '../config';
import { resolveRestaurantId } from './restaurantResolver';

export interface AuthResult {
  ok: boolean;
  botId?: string;              // The RestaurantBot.id (from header/URL)
  restaurantId?: string;        // The actual Restaurant.id (for DB queries)
  botName?: string;
  isAdmin?: boolean;
  error?: string;
}

/**
 * Authenticates a dashboard API request and resolves the restaurant ID
 * 
 * This function:
 * 1. Checks authentication (PAT or API Key)
 * 2. Extracts the RestaurantBot ID from X-Restaurant-Id header
 * 3. Resolves it to the actual Restaurant ID for database queries
 * 
 * @param req - The HTTP request
 * @returns AuthResult with both botId and restaurantId
 */
export async function authenticateDashboard(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();

  // PAT authentication (specific restaurant)
  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    const botId = (req.headers.get('x-restaurant-id') || '').trim();
    if (!botId) {
      return { ok: false, error: 'X-Restaurant-Id header is required for PAT' };
    }

    // Resolve RestaurantBot ID to actual Restaurant ID
    const resolved = await resolveRestaurantId(botId);
    if (!resolved) {
      return { ok: false, error: 'Restaurant not found' };
    }

    return {
      ok: true,
      botId: resolved.botId,
      restaurantId: resolved.restaurantId,
      botName: resolved.botName,
    };
  }

  // API Key authentication (admin access)
  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized' };
}

/**
 * Authenticates and requires a specific restaurant ID
 * Returns 401 if authentication fails
 * 
 * @param req - The HTTP request
 * @returns AuthResult with restaurant ID, or throws error details
 */
export async function requireDashboardAuth(req: Request): Promise<AuthResult> {
  const auth = await authenticateDashboard(req);
  
  if (!auth.ok) {
    throw { status: 401, error: auth.error || 'Unauthorized' };
  }
  
  if (!auth.isAdmin && !auth.restaurantId) {
    throw { status: 400, error: 'Restaurant ID required' };
  }
  
  return auth;
}


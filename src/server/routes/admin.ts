import { jsonResponse } from '../http';
import { prisma } from '../../db/client';

// Using string statuses to avoid enum import coupling
type RestaurantStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';

export async function handleAdmin(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/admin/restaurants')) {
    return null;
  }

  // NOTE: In a real app, you'd have proper admin authentication here
  if (req.method === 'GET' && url.pathname === '/api/admin/restaurants') {
    const status = url.searchParams.get('status') as RestaurantStatus | null;
    const whereClause = status ? { status } : {};
    
    const restaurants = await prisma.restaurant.findMany({
      where: whereClause
    });
    return jsonResponse(restaurants);
  }

  const match = url.pathname.match(/^\/api\/admin\/restaurants\/([^/]+)\/(approve|reject)$/);
  if (match && req.method === 'POST') {
    const [, restaurantId, action] = match;
    const newStatus: RestaurantStatus = action === 'approve' ? 'ACTIVE' : 'REJECTED';
    
    try {
      const updatedRestaurant = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { status: newStatus }
      });
      return jsonResponse(updatedRestaurant);
    } catch (error) {
      console.error(`❌ Failed to ${action} restaurant ${restaurantId}:`, error);
      return jsonResponse({ error: 'Failed to update restaurant status' }, 500);
    }
  }

  return null;
}

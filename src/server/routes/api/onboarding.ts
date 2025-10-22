/**
 * Onboarding API for dashboard
 * Provides dynamic onboarding state and available phone numbers
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse } from '../../../services/i18n';

type AuthResult = { ok: boolean; restaurantId?: string; isAdmin?: boolean; error?: string };

function authenticate(req: Request): AuthResult {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();

  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    const restaurantId = (req.headers.get('x-restaurant-id') || '').trim();
    if (!restaurantId) {
      return { ok: false, error: 'X-Restaurant-Id header is required' };
    }
    return { ok: true, restaurantId };
  }

  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized' };
}

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
}

/**
 * Generate onboarding checklist based on current state
 */
async function generateChecklist(restaurantId: string): Promise<ChecklistItem[]> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      bots: true,
      orders: true,
      user: true,
    },
  });

  if (!restaurant) {
    return [];
  }

  const bot = restaurant.bots.find((b) => b.isActive);
  const hasActiveBot = !!bot;
  const isBotVerified = bot?.verifiedAt !== null;
  const hasExternalMerchant = !!restaurant.externalMerchantId;
  const hasCompletedOrder = restaurant.orders.some((o) => o.status === 'DELIVERED');
  const hasProfileInfo = !!(restaurant.name && restaurant.address && restaurant.phone);
  const hasUserEmail = !!restaurant.user.email;

  const checklist: ChecklistItem[] = [
    {
      id: 'profile',
      title: 'Complete Restaurant Profile',
      description: 'Add your restaurant name, address, and contact information',
      completed: hasProfileInfo,
      required: true,
    },
    {
      id: 'email',
      title: 'Add Email Address',
      description: 'Provide an email for important notifications',
      completed: hasUserEmail,
      required: false,
    },
    {
      id: 'bot_setup',
      title: 'Set Up WhatsApp Bot',
      description: 'Configure your WhatsApp business number',
      completed: hasActiveBot,
      required: true,
    },
    {
      id: 'bot_verification',
      title: 'Verify WhatsApp Number',
      description: 'Complete the verification process for your WhatsApp number',
      completed: isBotVerified,
      required: true,
    },
    {
      id: 'merchant_link',
      title: 'Link Sufrah Account',
      description: 'Connect your Sufrah merchant account for menu integration',
      completed: hasExternalMerchant,
      required: false,
    },
    {
      id: 'first_order',
      title: 'Process First Order',
      description: 'Complete your first order through the bot',
      completed: hasCompletedOrder,
      required: false,
    },
  ];

  return checklist;
}

/**
 * Handle GET /api/onboarding
 * Returns onboarding progress and available phone numbers
 */
export async function handleOnboardingApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/onboarding
  if (url.pathname === '/api/onboarding' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      include: {
        user: {
          select: {
            phone: true,
            is_verified: true,
            verification_code: true,
            verification_expires_at: true,
          },
        },
        bots: {
          where: { isActive: true },
        },
      },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    const checklist = await generateChecklist(auth.restaurantId);
    const completedItems = checklist.filter((item) => item.completed).length;
    const totalItems = checklist.length;
    const progressPercent = Math.round((completedItems / totalItems) * 100);

    const bot = restaurant.bots[0];
    
    // Calculate verification timeline
    const verificationSteps = [];
    
    if (bot) {
      verificationSteps.push({
        step: 'Bot Created',
        status: 'completed',
        timestamp: bot.createdAt.toISOString(),
      });

      if (bot.status === 'VERIFYING') {
        verificationSteps.push({
          step: 'Verification Pending',
          status: 'in_progress',
          timestamp: bot.updatedAt.toISOString(),
        });
      } else if (bot.status === 'ACTIVE' && bot.verifiedAt) {
        verificationSteps.push({
          step: 'Verification Pending',
          status: 'completed',
          timestamp: bot.updatedAt.toISOString(),
        });
        verificationSteps.push({
          step: 'Verified',
          status: 'completed',
          timestamp: bot.verifiedAt.toISOString(),
        });
      } else if (bot.status === 'FAILED') {
        verificationSteps.push({
          step: 'Verification Failed',
          status: 'failed',
          timestamp: bot.updatedAt.toISOString(),
          error: bot.errorMessage,
        });
      }
    }

    return jsonResponse(
      createLocalizedResponse(
        {
          status: restaurant.status,
          progress: {
            completed: completedItems,
            total: totalItems,
            percent: progressPercent,
          },
          checklist,
          verification: {
            userVerified: restaurant.user.is_verified || false,
            botVerified: bot?.verifiedAt !== null,
            timeline: verificationSteps,
          },
          currentBot: bot ? {
            whatsappNumber: bot.whatsappNumber,
            status: bot.status,
            verifiedAt: bot.verifiedAt?.toISOString() || null,
          } : null,
        },
        locale
      )
    );
  }

  // GET /api/onboarding/phone-numbers - get available phone numbers
  // This would typically integrate with Twilio to fetch available numbers
  if (url.pathname === '/api/onboarding/phone-numbers' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const countryCode = url.searchParams.get('country_code') || 'SA';

    // In a real implementation, this would call Twilio API
    // For now, return a mock response
    const mockNumbers = [
      {
        phoneNumber: '+966500000001',
        friendlyName: 'Saudi Arabia +966 500-000-001',
        countryCode: 'SA',
        capabilities: ['SMS', 'WhatsApp'],
        monthlyCost: 100,
        currency: 'SAR',
        available: true,
      },
      {
        phoneNumber: '+966500000002',
        friendlyName: 'Saudi Arabia +966 500-000-002',
        countryCode: 'SA',
        capabilities: ['SMS', 'WhatsApp'],
        monthlyCost: 100,
        currency: 'SAR',
        available: true,
      },
    ];

    return jsonResponse(
      createLocalizedResponse(
        {
          countryCode,
          numbers: mockNumbers,
          note: 'Phone numbers are subject to availability. Contact support to complete provisioning.',
        },
        locale
      )
    );
  }

  return null;
}


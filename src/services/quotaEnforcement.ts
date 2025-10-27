/**
 * Quota Enforcement Service
 * Checks and enforces conversation limits for restaurants based on their plan
 */

import { getCurrentMonthUsage, getMonthlyAdjustmentsTotal } from "./usageTracking";

export interface PlanLimits {
  conversationsPerMonth: number;
  name: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
  planName: string;
  errorMessage?: string;
  errorCode?: string;
  // extended fields (non-breaking for existing callers)
  effectiveLimit?: number; // plan limit + adjustments
  adjustedBy?: number; // total adjustments this month
  usagePercent?: number; // 0-100, undefined for unlimited
  isNearingQuota?: boolean; // based on default 90% threshold
}

// Plan configurations - can be moved to database or config file later
export const PLANS: Record<string, PlanLimits> = {
  FREE: {
    conversationsPerMonth: 1000,
    name: "Free Plan",
  },
  BASIC: {
    conversationsPerMonth: 5000,
    name: "Basic Plan",
  },
  PRO: {
    conversationsPerMonth: 25000,
    name: "Pro Plan",
  },
  ENTERPRISE: {
    conversationsPerMonth: -1, // unlimited
    name: "Enterprise Plan",
  },
};

// Default plan for all restaurants (can be customized per restaurant later)
const DEFAULT_PLAN = "FREE";

/**
 * Checks if a restaurant has remaining quota to send messages
 * 
 * @param restaurantId - The restaurant ID
 * @param planType - The plan type (defaults to FREE)
 * @param referenceDate - The reference date (defaults to now)
 * @returns QuotaCheckResult with details about quota status
 */
export async function checkQuota(
  restaurantId: string,
  planType: string = DEFAULT_PLAN,
  referenceDate: Date = new Date()
): Promise<QuotaCheckResult> {
  // Get plan limits
  const plan = PLANS[planType] || PLANS[DEFAULT_PLAN];

  // If unlimited plan, always allow
  if (plan.conversationsPerMonth === -1) {
    return {
      allowed: true,
      remaining: -1,
      used: 0,
      limit: -1,
      planName: plan.name,
    };
  }

  // Get current month's usage
  const usage = await getCurrentMonthUsage(restaurantId, referenceDate);

  const used = usage.conversationCount;
  const planLimit = plan.conversationsPerMonth;

  // Sum admin adjustments (top-ups) for effective limit
  const month = referenceDate.getMonth() + 1;
  const year = referenceDate.getFullYear();
  const adjustedBy = planLimit === -1 ? 0 : await getMonthlyAdjustmentsTotal(restaurantId, month, year);
  const effectiveLimit = planLimit === -1 ? -1 : planLimit + adjustedBy;
  const limit = planLimit; // keep existing field as the base plan limit for backward compatibility
  const remaining = effectiveLimit === -1 ? -1 : Math.max(0, effectiveLimit - used);

  // Check if quota is exceeded
  if (effectiveLimit !== -1 && used >= effectiveLimit) {
    return {
      allowed: false,
      remaining: 0,
      used,
      limit, // base plan limit
      planName: plan.name,
      errorCode: "QUOTA_EXCEEDED",
      errorMessage: `Monthly conversation limit of ${effectiveLimit} reached. Used: ${used} conversations. Please upgrade your plan or wait until next month.`,
      effectiveLimit,
      adjustedBy,
      usagePercent: effectiveLimit === -1 ? undefined : Math.min(100, (used / effectiveLimit) * 100),
      isNearingQuota: effectiveLimit === -1 ? false : used / effectiveLimit >= 0.9,
    };
  }

  return {
    allowed: true,
    remaining,
    used,
    limit,
    planName: plan.name,
    effectiveLimit,
    adjustedBy,
    usagePercent: effectiveLimit === -1 ? undefined : Math.min(100, (used / effectiveLimit) * 100),
    isNearingQuota: effectiveLimit === -1 ? false : used / effectiveLimit >= 0.9,
  };
}

/**
 * Checks quota and throws an error if exceeded
 * 
 * @param restaurantId - The restaurant ID
 * @param planType - The plan type (defaults to FREE)
 * @param referenceDate - The reference date (defaults to now)
 * @throws Error if quota is exceeded
 */
export async function enforceQuota(
  restaurantId: string,
  planType: string = DEFAULT_PLAN,
  referenceDate: Date = new Date()
): Promise<void> {
  const result = await checkQuota(restaurantId, planType, referenceDate);

  if (!result.allowed) {
    const error = new Error(result.errorMessage);
    (error as any).code = result.errorCode;
    (error as any).quotaInfo = {
      used: result.used,
      limit: result.limit,
      remaining: result.remaining,
      planName: result.planName,
    };
    throw error;
  }
}

/**
 * Gets quota status for a restaurant
 * 
 * @param restaurantId - The restaurant ID
 * @param planType - The plan type (defaults to FREE)
 * @param referenceDate - The reference date (defaults to now)
 * @returns QuotaCheckResult with quota details
 */
export async function getQuotaStatus(
  restaurantId: string,
  planType: string = DEFAULT_PLAN,
  referenceDate: Date = new Date()
): Promise<QuotaCheckResult> {
  return await checkQuota(restaurantId, planType, referenceDate);
}

/**
 * Checks if a restaurant is nearing their quota limit
 * 
 * @param restaurantId - The restaurant ID
 * @param threshold - Percentage threshold (e.g., 0.9 for 90%)
 * @param planType - The plan type (defaults to FREE)
 * @param referenceDate - The reference date (defaults to now)
 * @returns true if usage is at or above threshold
 */
export async function isNearingQuota(
  restaurantId: string,
  threshold: number = 0.9,
  planType: string = DEFAULT_PLAN,
  referenceDate: Date = new Date()
): Promise<boolean> {
  const result = await checkQuota(restaurantId, planType, referenceDate);

  // Unlimited plans never near quota
  if (result.limit === -1) {
    return false;
  }

  const usagePercentage = result.used / result.limit;
  return usagePercentage >= threshold;
}

/**
 * Gets quota usage percentage
 * 
 * @param restaurantId - The restaurant ID
 * @param planType - The plan type (defaults to FREE)
 * @param referenceDate - The reference date (defaults to now)
 * @returns Usage percentage (0-100), or -1 for unlimited plans
 */
export async function getQuotaUsagePercentage(
  restaurantId: string,
  planType: string = DEFAULT_PLAN,
  referenceDate: Date = new Date()
): Promise<number> {
  const result = await checkQuota(restaurantId, planType, referenceDate);

  // Unlimited plans return -1
  if (result.limit === -1) {
    return -1;
  }

  return (result.used / result.limit) * 100;
}

/**
 * Calculates days until quota resets (start of next month)
 * 
 * @param referenceDate - The reference date (defaults to now)
 * @returns Number of days until quota reset
 */
export function getDaysUntilQuotaReset(referenceDate: Date = new Date()): number {
  const now = new Date(referenceDate);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((nextMonth.getTime() - now.getTime()) / msPerDay);
  return daysRemaining;
}

/**
 * Gets formatted quota reset date
 * 
 * @param referenceDate - The reference date (defaults to now)
 * @returns ISO string of quota reset date
 */
export function getQuotaResetDate(referenceDate: Date = new Date()): string {
  const now = new Date(referenceDate);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

/**
 * Creates a user-friendly quota error response
 * 
 * @param result - The quota check result
 * @returns Formatted error response object
 */
export function formatQuotaError(result: QuotaCheckResult): {
  error: string;
  code: string;
  details: {
    used: number;
    limit: number;
    remaining: number;
    planName: string;
    resetDate: string;
    daysUntilReset: number;
  };
} {
  return {
    error: result.errorMessage || "Quota limit reached",
    code: result.errorCode || "QUOTA_EXCEEDED",
    details: {
      used: result.used,
      limit: result.limit,
      remaining: result.remaining,
      planName: result.planName,
      resetDate: getQuotaResetDate(),
      daysUntilReset: getDaysUntilQuotaReset(),
    },
  };
}


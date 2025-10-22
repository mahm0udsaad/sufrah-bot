/**
 * Session Detection Service
 * Detects and manages 24-hour conversation sessions for usage tracking
 */

import { prisma } from "../db/client";

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export interface SessionInfo {
  isNewSession: boolean;
  sessionId: string;
  sessionStart: Date;
  sessionEnd: Date;
}

/**
 * Detects if a message represents a new 24-hour conversation session
 * 
 * A new session is created when:
 * 1. No previous session exists for this customer-restaurant pair
 * 2. The most recent session has ended (24 hours have passed)
 * 
 * @param restaurantId - The restaurant ID
 * @param customerWa - The customer WhatsApp number
 * @param messageTimestamp - The timestamp of the current message
 * @returns SessionInfo with details about the session
 */
export async function detectSession(
  restaurantId: string,
  customerWa: string,
  messageTimestamp: Date = new Date()
): Promise<SessionInfo> {
  // Find the most recent session for this customer-restaurant pair
  const recentSession = await prisma.conversationSession.findFirst({
    where: {
      restaurantId,
      customerWa,
    },
    orderBy: {
      sessionEnd: "desc",
    },
  });

  const now = messageTimestamp;

  // If no session exists, or the most recent session has ended
  if (!recentSession || now >= recentSession.sessionEnd) {
    // Create a new session
    const sessionStart = now;
    const sessionEnd = new Date(now.getTime() + SESSION_DURATION_MS);

    try {
      const newSession = await prisma.conversationSession.create({
        data: {
          restaurantId,
          customerWa,
          sessionStart,
          sessionEnd,
          messageCount: 1,
        },
      });

      return {
        isNewSession: true,
        sessionId: newSession.id,
        sessionStart: newSession.sessionStart,
        sessionEnd: newSession.sessionEnd,
      };
    } catch (error: any) {
      // Handle unique constraint violation (P2002) - concurrent request created session
      if (error.code === 'P2002') {
        console.log(`🔄 Concurrent session creation detected for ${restaurantId}:${customerWa}, retrying lookup...`);
        
        // Retry: look up the session that was just created by the concurrent request
        const existingSession = await prisma.conversationSession.findFirst({
          where: {
            restaurantId,
            customerWa,
            sessionEnd: { gte: now },
          },
          orderBy: {
            sessionEnd: 'desc',
          },
        });

        if (existingSession) {
          // Increment message count on the existing session
          const proposedEnd = new Date(now.getTime() + SESSION_DURATION_MS);
          const updatedSession = await prisma.conversationSession.update({
            where: { id: existingSession.id },
            data: {
              messageCount: {
                increment: 1,
              },
              ...(proposedEnd > existingSession.sessionEnd
                ? { sessionEnd: proposedEnd }
                : {}),
            },
          });

          return {
            isNewSession: false,
            sessionId: updatedSession.id,
            sessionStart: updatedSession.sessionStart,
            sessionEnd: updatedSession.sessionEnd,
          };
        }
      }
      
      // Re-throw if not a unique constraint error or retry failed
      throw error;
    }
  }

  // Session is still active - increment message count
  const proposedEnd = new Date(now.getTime() + SESSION_DURATION_MS);

  const updatedSession = await prisma.conversationSession.update({
    where: { id: recentSession.id },
    data: {
      messageCount: {
        increment: 1,
      },
      ...(proposedEnd > recentSession.sessionEnd
        ? { sessionEnd: proposedEnd }
        : {}),
    },
  });

  return {
    isNewSession: false,
    sessionId: updatedSession.id,
    sessionStart: updatedSession.sessionStart,
    sessionEnd: updatedSession.sessionEnd,
  };
}

/**
 * Checks if a session is still active (within 24-hour window)
 * 
 * @param sessionEnd - The session end timestamp
 * @param checkTimestamp - The timestamp to check against (defaults to now)
 * @returns true if the session is still active
 */
export function isSessionActive(
  sessionEnd: Date,
  checkTimestamp: Date = new Date()
): boolean {
  return checkTimestamp < sessionEnd;
}

/**
 * Gets the active session for a customer-restaurant pair
 * 
 * @param restaurantId - The restaurant ID
 * @param customerWa - The customer WhatsApp number
 * @param checkTimestamp - The timestamp to check against (defaults to now)
 * @returns The active session or null if no active session exists
 */
export async function getActiveSession(
  restaurantId: string,
  customerWa: string,
  checkTimestamp: Date = new Date()
) {
  const recentSession = await prisma.conversationSession.findFirst({
    where: {
      restaurantId,
      customerWa,
      sessionEnd: {
        gt: checkTimestamp, // Session end is in the future
      },
    },
    orderBy: {
      sessionEnd: "desc",
    },
  });

  return recentSession;
}

/**
 * Calculates time remaining in a session
 * 
 * @param sessionEnd - The session end timestamp
 * @param checkTimestamp - The timestamp to check against (defaults to now)
 * @returns milliseconds remaining, or 0 if session has ended
 */
export function getSessionTimeRemaining(
  sessionEnd: Date,
  checkTimestamp: Date = new Date()
): number {
  const remaining = sessionEnd.getTime() - checkTimestamp.getTime();
  return Math.max(0, remaining);
}

/**
 * Gets session statistics for a restaurant within a date range
 * 
 * @param restaurantId - The restaurant ID
 * @param startDate - Start of the date range
 * @param endDate - End of the date range
 * @returns Session statistics
 */
export async function getSessionStats(
  restaurantId: string,
  startDate: Date,
  endDate: Date
) {
  const sessions = await prisma.conversationSession.findMany({
    where: {
      restaurantId,
      sessionStart: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      id: true,
      customerWa: true,
      sessionStart: true,
      sessionEnd: true,
      messageCount: true,
    },
  });

  const uniqueCustomers = new Set(sessions.map((s) => s.customerWa)).size;
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);

  return {
    totalSessions: sessions.length,
    uniqueCustomers,
    totalMessages,
    averageMessagesPerSession:
      sessions.length > 0 ? totalMessages / sessions.length : 0,
    sessions,
  };
}

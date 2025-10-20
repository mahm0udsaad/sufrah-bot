import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import twilio from 'twilio';
import {
  REDIS_URL,
  OUTBOUND_QUEUE_NAME,
  QUEUE_RETRY_ATTEMPTS,
  QUEUE_BACKOFF_DELAY,
} from '../config';
import { getRestaurantById } from '../db/restaurantService';
import { createOutboundMessage, updateMessageWithSid } from '../db/messageService';
import { updateConversation } from '../db/conversationService';
import { eventBus } from './eventBus';
import { getRenderedTemplatePreview } from '../services/templatePreview';

// Job data type for outbound messages
export interface OutboundMessageJob {
  restaurantId: string;
  conversationId: string;
  to: string; // customer WhatsApp number
  body?: string;
  mediaUrl?: string;
  contentSid?: string;
  variables?: Record<string, string>;
  messageType?: string;
}

// Create Redis connection for BullMQ
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create outbound message queue
export const outboundQueue = new Queue<OutboundMessageJob>(OUTBOUND_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: QUEUE_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: QUEUE_BACKOFF_DELAY,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

/**
 * Enqueue an outbound WhatsApp message
 */
export async function enqueueOutboundMessage(
  job: OutboundMessageJob,
  priority: number = 0
): Promise<void> {
  await outboundQueue.add('send-whatsapp', job, { priority });
  console.log(`📤 Enqueued message for restaurant ${job.restaurantId} to ${job.to}`);
}

/**
 * Worker to process outbound messages
 */
export function startOutboundWorker(): Worker<OutboundMessageJob> {
  const worker = new Worker<OutboundMessageJob>(
    OUTBOUND_QUEUE_NAME,
    async (job: Job<OutboundMessageJob>) => {
      const { restaurantId, conversationId, to, body, mediaUrl, contentSid, variables, messageType } = job.data;

      console.log(`🔄 Processing outbound message job ${job.id} for restaurant ${restaurantId}`);

      // Get restaurant to retrieve Twilio credentials
      const restaurant = await getRestaurantById(restaurantId);
      if (!restaurant) {
        throw new Error(`Restaurant ${restaurantId} not found`);
      }

      if (!restaurant.isActive) {
        throw new Error(`Restaurant ${restaurantId} is not active`);
      }

      // Create Twilio client (use subaccount if configured)
      const twilioClient = restaurant.twilioSubaccountSid
        ? twilio(restaurant.twilioSubaccountSid, restaurant.twilioAuthToken, {
            accountSid: restaurant.twilioAccountSid,
          })
        : twilio(restaurant.twilioAccountSid, restaurant.twilioAuthToken);

      // Ensure WhatsApp format
      const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      const fromNumber = restaurant.whatsappFrom;

      // Persist message BEFORE sending (optimistic)
      const messageRecord = await createOutboundMessage({
        conversationId,
        restaurantId,
        fromPhone: fromNumber,
        toPhone: to,
        messageType: messageType || 'text',
        content: body || contentSid || '',
        mediaUrl,
        metadata: variables ? { variables } : undefined,
      });

      let twilioResponse;

      try {
        // Send via Twilio
        if (contentSid) {
          // Send content template
          twilioResponse = await twilioClient.messages.create({
            from: fromNumber,
            to: toNumber,
            contentSid,
            contentVariables: variables ? JSON.stringify(variables) : undefined,
          });
        } else if (mediaUrl) {
          // Send media message
          twilioResponse = await twilioClient.messages.create({
            from: fromNumber,
            to: toNumber,
            body: body || '',
            mediaUrl: [mediaUrl],
          });
        } else {
          // Send text message
          twilioResponse = await twilioClient.messages.create({
            from: fromNumber,
            to: toNumber,
            body: body || '',
          });
        }

        // Update message with Twilio SID
        await updateMessageWithSid(messageRecord.id, twilioResponse.sid);

        // Update conversation lastMessageAt
        await updateConversation(conversationId, {
          lastMessageAt: new Date(),
        });

        // Fetch template preview if this is a template message
        let templatePreview = null;
        if (contentSid) {
          try {
            templatePreview = await getRenderedTemplatePreview(contentSid, variables);
            console.log(`📋 [Queue] Fetched template preview for ${contentSid}`);
          } catch (error) {
            console.warn(`⚠️ [Queue] Failed to fetch template preview:`, error);
          }
        }

        // Publish real-time event with template preview
        await eventBus.publishMessage(restaurantId, {
          type: 'message.sent',
          message: {
            id: messageRecord.id,
            conversationId,
            content: body || contentSid || '',
            messageType: contentSid ? 'template' : messageType || 'text',
            direction: 'OUT',
            createdAt: messageRecord.createdAt,
            ...(contentSid && {
              contentSid,
              variables,
            }),
            ...(templatePreview && {
              templatePreview: {
                sid: templatePreview.sid,
                friendlyName: templatePreview.friendlyName,
                body: templatePreview.body,
                buttons: templatePreview.buttons,
                contentType: templatePreview.contentType,
                language: templatePreview.language,
              },
            }),
          },
        });

        console.log(`✅ Sent message ${twilioResponse.sid} to ${to}`);
        return { success: true, sid: twilioResponse.sid };
      } catch (error: any) {
        console.error(`❌ Failed to send message to ${to}:`, error);
        
        // On final failure, publish error event
        if (job.attemptsMade >= QUEUE_RETRY_ATTEMPTS) {
          await eventBus.publishMessage(restaurantId, {
            type: 'message.failed',
            message: {
              id: messageRecord.id,
              conversationId,
              error: error.message,
            },
          });
        }
        
        throw error;
      }
    },
    {
      connection,
      concurrency: 10, // Process up to 10 messages in parallel
      limiter: {
        max: 60, // Max 60 jobs per duration
        duration: 60000, // 60 seconds (Twilio rate limit)
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('❌ Worker error:', err);
  });

  console.log('🚀 Outbound message worker started');

  return worker;
}

// Graceful shutdown
let queueShuttingDown = false;
process.on('beforeExit', async () => {
  if (queueShuttingDown) {
    return;
  }
  queueShuttingDown = true;

  const results = await Promise.allSettled([
    outboundQueue.close(),
    connection.quit(),
  ]);

  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('❌ Error closing outbound queue Redis connection:', result.reason);
    }
  });
});

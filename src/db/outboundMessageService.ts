import { prisma } from './client';

export type OutboundChannel = 'freeform' | 'template';

interface BaseLogPayload {
  restaurantId: string | null;
  conversationId?: string | null;
  toPhone: string;
  fromPhone: string;
  body?: string;
  channel?: OutboundChannel;
  templateSid?: string | null;
  templateName?: string | null;
  status?: 'pending' | 'sent' | 'failed';
  metadata?: Record<string, any> | null;
}

function getOutboundModel(): any {
  const model = (prisma as any)?.outboundMessage;
  if (!model || typeof model.create !== 'function') {
    console.warn(
      '⚠️ OutboundMessage model is not available on the Prisma client. Did you run the latest migrations?' 
    );
    return null;
  }
  return model;
}

export async function createOutboundMessageLog(payload: BaseLogPayload) {
  const model = getOutboundModel();
  if (!model) {
    return null;
  }

  return model.create({
    data: {
      restaurantId: payload.restaurantId,
      conversationId: payload.conversationId ?? null,
      toPhone: payload.toPhone,
      fromPhone: payload.fromPhone,
      body: payload.body ?? null,
      channel: payload.channel ?? null,
      templateSid: payload.templateSid ?? null,
      templateName: payload.templateName ?? null,
      status: payload.status ?? 'pending',
      metadata: payload.metadata ?? null,
    },
  });
}

export async function updateOutboundMessageChannel(
  id: string | null | undefined,
  channel: OutboundChannel,
  metadata?: Record<string, any>,
  templateSid?: string,
  templateName?: string
) {
  if (!id) return;
  const model = getOutboundModel();
  if (!model) return;

  await model.update({
    where: { id },
    data: {
      channel,
      templateSid: templateSid ?? undefined,
      templateName: templateName ?? undefined,
      metadata: metadata ? { set: metadata } : undefined,
    },
  });
}

export async function markOutboundMessageSent(
  id: string | null | undefined,
  params: { 
    channel: OutboundChannel; 
    waSid: string; 
    templateSid?: string;
    templateName?: string;
    metadata?: Record<string, any>;
  }
) {
  if (!id) return;
  const model = getOutboundModel();
  if (!model) return;

  await model.update({
    where: { id },
    data: {
      status: 'sent',
      channel: params.channel,
      waSid: params.waSid,
      templateSid: params.templateSid ?? undefined,
      templateName: params.templateName ?? undefined,
      metadata: params.metadata ? { set: params.metadata } : undefined,
    },
  });
}

export async function markOutboundMessageFailed(
  id: string | null | undefined,
  params: {
    channel: OutboundChannel;
    error: unknown;
    metadata?: Record<string, any>;
  }
) {
  if (!id) return;
  const model = getOutboundModel();
  if (!model) return;

  const { code, message, extra } = extractErrorDetails(params.error);

  await model.update({
    where: { id },
    data: {
      status: 'failed',
      channel: params.channel,
      errorCode: code ?? null,
      errorMessage: message ?? null,
      metadata: params.metadata
        ? { set: { ...params.metadata, lastError: extra } }
        : { set: { lastError: extra } },
    },
  });
}

function extractErrorDetails(error: unknown): {
  code?: string;
  message?: string;
  extra?: Record<string, any>;
} {
  if (!error || typeof error !== 'object') {
    return {
      message: typeof error === 'string' ? error : 'Unknown error',
      extra: { raw: error },
    };
  }

  const err = error as any;
  const code =
    typeof err.code === 'number' || typeof err.code === 'string'
      ? String(err.code)
      : undefined;
  const message = typeof err.message === 'string' ? err.message : undefined;
  const extra: Record<string, any> = {};

  if (typeof err.status !== 'undefined') {
    extra.status = err.status;
  }
  if (typeof err.moreInfo === 'string') {
    extra.moreInfo = err.moreInfo;
  }
  if (typeof err.details !== 'undefined') {
    extra.details = err.details;
  }
  if (!message && err.toString) {
    extra.fallbackMessage = String(err);
  }

  return { code, message, extra };
}

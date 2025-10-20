import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from '../config';

/**
 * Template preview service for fetching and structuring WhatsApp template data
 * This provides the dashboard with complete template information for rendering
 */

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  title: string;
  id?: string;
  url?: string;
  phone_number?: string;
}

export interface TemplatePreview {
  sid: string;
  friendlyName: string;
  language: string;
  body: string;
  buttons: TemplateButton[];
  variables?: Record<string, string>;
  contentType: 'text' | 'quick-reply' | 'card' | 'list-picker';
}

interface TwilioContentResponse {
  sid: string;
  friendly_name: string;
  language: string;
  types: {
    'twilio/text'?: {
      body: string;
    };
    'twilio/quick-reply'?: {
      body: string;
      actions?: Array<{
        title: string;
        id?: string;
        type?: string;
        url?: string;
        phone_number?: string;
      }>;
    };
    'twilio/card'?: {
      title?: string;
      subtitle?: string;
      body: string;
      actions?: Array<any>;
    };
    'twilio/list-picker'?: {
      body: string;
      button?: string;
      items?: Array<any>;
    };
  };
  variables?: Record<string, string>;
}

/**
 * Cache for template previews to avoid repeated API calls
 */
const templateCache = new Map<string, { preview: TemplatePreview; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch template details from Twilio Content API
 */
export async function fetchTemplatePreview(contentSid: string): Promise<TemplatePreview | null> {
  // Check cache first
  const cached = templateCache.get(contentSid);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.preview;
  }

  try {
    const authHeader = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const url = `https://content.twilio.com/v1/Content/${contentSid}`;

    console.log(`[TemplatePreview] Fetching template details for: ${contentSid}`);

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${authHeader}`,
      },
    });

    if (!response.ok) {
      console.error(`[TemplatePreview] Failed to fetch template ${contentSid}: ${response.status}`);
      return null;
    }

    const data: TwilioContentResponse = await response.json();
    const preview = parseTemplateContent(data);

    // Cache the result
    templateCache.set(contentSid, { preview, timestamp: Date.now() });

    return preview;
  } catch (error) {
    console.error(`[TemplatePreview] Error fetching template ${contentSid}:`, error);
    return null;
  }
}

/**
 * Parse Twilio Content API response into a structured preview
 */
function parseTemplateContent(data: TwilioContentResponse): TemplatePreview {
  let body = '';
  let buttons: TemplateButton[] = [];
  let contentType: TemplatePreview['contentType'] = 'text';

  // Check for quick-reply type (has buttons)
  if (data.types['twilio/quick-reply']) {
    const quickReply = data.types['twilio/quick-reply'];
    body = quickReply.body;
    contentType = 'quick-reply';

    if (quickReply.actions) {
      buttons = quickReply.actions.map((action) => ({
        type: (action.type as any) || 'QUICK_REPLY',
        title: action.title,
        id: action.id,
        url: action.url,
        phone_number: action.phone_number,
      }));
    }
  }
  // Check for card type
  else if (data.types['twilio/card']) {
    const card = data.types['twilio/card'];
    body = card.body;
    contentType = 'card';

    if (card.actions) {
      buttons = card.actions.map((action) => ({
        type: (action.type as any) || 'QUICK_REPLY',
        title: action.title,
        id: action.id,
        url: action.url,
        phone_number: action.phone_number,
      }));
    }
  }
  // Check for list-picker type
  else if (data.types['twilio/list-picker']) {
    const listPicker = data.types['twilio/list-picker'];
    body = listPicker.body;
    contentType = 'list-picker';
  }
  // Fallback to text type
  else if (data.types['twilio/text']) {
    body = data.types['twilio/text'].body;
    contentType = 'text';
  }

  return {
    sid: data.sid,
    friendlyName: data.friendly_name,
    language: data.language,
    body,
    buttons,
    variables: data.variables,
    contentType,
  };
}

/**
 * Replace template variables in body text with actual values
 */
export function renderTemplateBody(
  body: string,
  variables?: Record<string, string>
): string {
  if (!variables) return body;

  let rendered = body;

  // Replace {{1}}, {{2}}, etc. with actual values
  Object.entries(variables).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || `{{${key}}}`);
  });

  return rendered;
}

/**
 * Create a complete template preview with rendered values
 */
export async function getRenderedTemplatePreview(
  contentSid: string,
  variables?: Record<string, string>
): Promise<TemplatePreview | null> {
  const preview = await fetchTemplatePreview(contentSid);
  
  if (!preview) return null;

  // Render body with variables
  const renderedBody = renderTemplateBody(preview.body, variables);

  return {
    ...preview,
    body: renderedBody,
    variables,
  };
}

/**
 * Clear cache for a specific template or all templates
 */
export function clearTemplateCache(contentSid?: string): void {
  if (contentSid) {
    templateCache.delete(contentSid);
  } else {
    templateCache.clear();
  }
}


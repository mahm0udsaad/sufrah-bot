const MAX_MESSAGE_LENGTH = 1200; // Keep well under Twilio's 1600 character limit

/**
 * Splits a long message into multiple chunks that fit within WhatsApp's character limit
 */
export function splitLongMessage(message: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  if (message.length <= maxLength) {
    return [message];
  }

  const chunks: string[] = [];
  const lines = message.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    // If adding this line would exceed the limit, save current chunk and start new one
    if (currentChunk.length + line.length + 1 > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export function buildCategoriesFallback(
  categories: Array<{ item: string; description?: string }>
): string {
  return `🍽️ تصفح قائمتنا:\n\n${categories
    .map((cat, index) => `${index + 1}. ${cat.item}${cat.description ? ` — ${cat.description}` : ''}`)
    .join('\n')}\n\nاكتب رقم الفئة أو اسمها.`;
}

export function matchesAnyTrigger(
  body: string,
  triggers: Array<string | RegExp>
): boolean {
  if (!body) return false;
  return triggers.some((trigger) => {
    if (typeof trigger === 'string') {
      return body.includes(trigger);
    }
    return trigger.test(body);
  });
}

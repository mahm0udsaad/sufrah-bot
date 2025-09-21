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

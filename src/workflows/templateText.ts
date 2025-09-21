const templateTextBySid = new Map<string, string>();
const templateTextByKey = new Map<string, string>();

export function registerTemplateTextForSid(sid: string, text?: string | null) {
  if (!sid || !text) return;
  templateTextBySid.set(sid, text);
}

export function registerTemplateTextForKey(key: string, text?: string | null) {
  if (!key || !text) return;
  templateTextByKey.set(key, text);
}

export function rememberTemplateText(key: string, sid: string) {
  const text = templateTextByKey.get(key);
  if (text) {
    templateTextBySid.set(sid, text);
  }
}

export function resolveTemplateDisplay(content: string): string | undefined {
  if (!content.startsWith('content:')) return undefined;
  const sid = content.slice('content:'.length);
  return templateTextBySid.get(sid);
}

export function exportTemplateTextMaps() {
  return { templateTextBySid, templateTextByKey };
}

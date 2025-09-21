export async function createContent(
  authHeader: string,
  payload: any,
  logLabel?: string
): Promise<string> {
  const url = 'https://content.twilio.com/v1/Content';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio Content API error ${res.status}: ${text}`);
  }

  const json: any = await res.json();
  if (logLabel) {
    console.log(`✅ ${logLabel}: ${json.sid}`);
  }
  return json.sid as string;
}

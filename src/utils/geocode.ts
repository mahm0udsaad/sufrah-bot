export async function getReadableAddress(
  lat: string,
  lon: string,
  userAgent: string
): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=ar`,
      {
        headers: {
          'User-Agent': userAgent,
        },
      }
    );
    if (!res.ok) {
      console.error('❌ Nominatim request failed:', await res.text());
      return '📍 الموقع غير متاح';
    }
    const data: any = await res.json();
    if (data && data.display_name) {
      return data.display_name as string;
    }
    return '📍 الموقع غير متاح';
  } catch (err) {
    console.error('❌ Error in reverse geocoding:', err);
    return '📍 الموقع غير متاح';
  }
}

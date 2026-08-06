/**
 * Location Service for Sniffr
 * Provides consistent GPS location fetching, reverse geocoding, and stored location sync across all features.
 */

/**
 * Reverse geocodes lat/lng into { country, state, city, area }
 * Uses OpenStreetMap Nominatim reverse geocoding with timeout handling.
 */
export async function reverseGeocode(lat, lng) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: { 'Accept-Language': 'en' },
        signal: controller.signal
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('Geocoding service unavailable');
    const data = await res.json();
    const addr = data.address || {};

    const country = addr.country || (addr.country_code ? addr.country_code.toUpperCase() : '');
    const state = addr.state || addr.region || addr.state_district || addr.province || '';
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.suburb || '';
    const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.residential || addr.road || addr.district || addr.city_district || '';

    return { country, state, city, area };
  } catch (err) {
    console.warn('Reverse geocoding fallback triggered:', err);
    return { country: '', state: '', city: '', area: '' };
  }
}

/**
 * Requests device GPS location with high precision and reverse geocodes into location fields.
 * Returns { latitude, longitude, country, state, city, area }
 */
export async function getCurrentGPSLocation() {
  if (!navigator.geolocation) {
    throw new Error('LOCATION_UNSUPPORTED');
  }

  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000
      }
    );
  });

  const { latitude, longitude } = pos.coords;
  const geocoded = await reverseGeocode(latitude, longitude);

  const locationData = {
    latitude,
    longitude,
    country: geocoded.country || '',
    state: geocoded.state || '',
    city: geocoded.city || '',
    area: geocoded.area || '',
    timestamp: Date.now()
  };

  try {
    localStorage.setItem('sniffr_user_gps_location', JSON.stringify(locationData));
  } catch (e) {
    /* ignore storage errors */
  }

  return locationData;
}

/**
 * Gets stored location data if available.
 */
export function getStoredLocation() {
  try {
    const data = localStorage.getItem('sniffr_user_gps_location');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// Cloudinary serves the exact original upload by default (see
// server/storage/CloudStorage.js -- upload() never applies a transform, and
// getUrl() just echoes the stored secure_url back). That means a profile
// photo taken on a modern phone (often 3-4000px wide, several MB) gets
// downloaded at FULL resolution even when it's rendered as a 40px avatar
// or a 300px feed thumbnail -- on mobile data this is the single biggest
// avoidable cost in the app.
//
// Cloudinary supports on-the-fly resizing by inserting a transformation
// segment into the existing delivery URL (no re-upload, no backend change,
// no risk to already-stored URLs) -- e.g.:
//   https://res.cloudinary.com/<cloud>/image/upload/v169/sniffr/posts/x.jpg
//   -> .../image/upload/w_400,q_auto,f_auto/v169/sniffr/posts/x.jpg
// f_auto picks the smallest format the requesting browser supports (AVIF/
// WebP where possible), q_auto picks the smallest quality that still looks
// good, and w_<n> caps the delivered pixel width -- combined this typically
// cuts image payload by 70-90% with no visible quality loss at these sizes.
//
// Any non-Cloudinary URL (local /public assets like /logo.png, or a URL
// from a differently-configured environment) is returned unchanged --
// this function is purely additive and never breaks a URL it doesn't
// recognize.
export function optimizedImage(url, width, { quality = 'auto', crop = 'limit' } = {}) {
  if (!url || typeof url !== 'string') return url;
  const marker = '/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1 || !url.includes('res.cloudinary.com')) return url;

  const transform = `c_${crop},w_${width},q_${quality},f_auto`;
  return url.slice(0, idx + marker.length) + transform + '/' + url.slice(idx + marker.length);
}

// Common fixed sizes used across the app's avatar treatments, so call
// sites don't need to hand-pick a width per component. Deliberately
// requests device-pixel-ratio-aware sizes bumped up one notch (e.g. 96 for
// a 40-48px CSS box) rather than the exact CSS size, so retina screens
// don't look soft -- still a small fraction of the original upload size.
export const avatarUrl = (url) => optimizedImage(url, 96);
export const thumbnailUrl = (url) => optimizedImage(url, 400);
export const feedMediaUrl = (url) => optimizedImage(url, 720);

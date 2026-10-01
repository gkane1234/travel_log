const REQUIRED = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "MEDIA_BASE_URL",
  "MEDIA_PASSWORD",
];

export function missingConfig(env) {
  const source = env || {};
  const missing = REQUIRED.filter((key) => !String(source[key] || "").trim());
  const hasUploadToken = String(source.UPLOAD_TOKEN || "").trim();
  const hasRepo = String(source.GITHUB_REPOSITORY || "").trim();
  if (!hasUploadToken && !hasRepo) missing.push("GITHUB_REPOSITORY or UPLOAD_TOKEN");
  return missing;
}

export function storageConfigError(env) {
  const missing = missingConfig(env);
  if (!missing.length) return null;
  return `Media storage is not configured (${missing.join(", ")}).`;
}

export const PUBLIC_PREFIX = "/travel-log";

export function siteOrigin(base) {
  let origin = String(base || "").trim().replace(/\/$/, "");
  if (origin.endsWith(PUBLIC_PREFIX)) origin = origin.slice(0, -PUBLIC_PREFIX.length);
  else if (origin.endsWith("/travel_log")) origin = origin.slice(0, -"/travel_log".length);
  return origin;
}

export function mediaPublicUrl(base, key) {
  return `${siteOrigin(base)}${PUBLIC_PREFIX}/${key}`;
}

const KEY = /^media\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9._-]{0,120}$/;

export function isAllowedKey(key) {
  return typeof key === "string" && KEY.test(key) && !key.includes("..");
}

const TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export function isAllowedType(type) {
  return TYPES.has(type);
}

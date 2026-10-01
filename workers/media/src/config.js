const REQUIRED = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "PUBLIC_BASE_URL"];

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

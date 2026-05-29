export const config = {
  baseUrl: process.env.AI_BASE_URL || '',
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || 'deepseek-chat',
  port: parseInt(process.env.PORT || '3001', 10),
  storageDir: process.env.STORAGE_DIR || './data',
  jwtSecret: process.env.JWT_SECRET || 'travel-dev-secret',
  amapKey: process.env.AMAP_API_KEY || '',
}

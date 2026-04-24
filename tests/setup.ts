import { beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Use a unique temp dir for each test run
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-travel-test-'))

process.env.AI_BASE_URL = 'https://api.deepseek.com'
process.env.AI_API_KEY = 'test-key-for-unit-tests'
process.env.AI_MODEL = 'deepseek-chat'
process.env.STORAGE_DIR = testDir
process.env.JWT_SECRET = 'test-secret-for-unit-tests'

beforeAll(() => {
  // Cleanup after all tests
  return () => fs.rmSync(testDir, { recursive: true, force: true })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { generateItineraryTool, itineraryResult } from '../../src/tools/itinerary'

/**
 * Itinerary tool regression tests.
 *
 * Tests JSON parsing, validation, code fence stripping, and the
 * shared itineraryResult side-effect mechanism.
 */

const func = generateItineraryTool.func

beforeEach(() => {
  itineraryResult.data = null
})

const VALID_ITINERARY = {
  meta: {
    city: '杭州',
    days: 2,
    summary: '杭州两日游',
    budgetTotal: 2000,
    constraints: ['假设住西湖附近'],
  },
  days: [
    {
      dayIndex: 0,
      theme: '西湖经典',
      blocks: [
        { start: '09:00', end: '12:00', title: '西湖', type: 'sight', why: '必去景点' },
        { start: '12:00', end: '13:00', title: '楼外楼', type: 'food', why: '品尝西湖醋鱼' },
      ],
    },
  ],
}

describe('Itinerary tool: valid input', () => {
  it('should parse and save valid itinerary JSON', async () => {
    const result = await func({ data: JSON.stringify(VALID_ITINERARY) })
    expect(result).toContain('成功')
    expect(itineraryResult.data).not.toBeNull()
    expect(itineraryResult.data?.meta.city).toBe('杭州')
    expect(itineraryResult.data?.meta.days).toBe(2)
  })

  it('should parse itinerary with code fences', async () => {
    const withFences = '```json\n' + JSON.stringify(VALID_ITINERARY) + '\n```'
    const result = await func({ data: withFences })
    expect(result).toContain('成功')
    expect(itineraryResult.data?.meta.city).toBe('杭州')
  })

  it('should parse itinerary with triple backticks without json label', async () => {
    const withFences = '```\n' + JSON.stringify(VALID_ITINERARY) + '\n```'
    const result = await func({ data: withFences })
    expect(result).toContain('成功')
    expect(itineraryResult.data?.meta.city).toBe('杭州')
  })

  it('should handle multiple days with time blocks', async () => {
    const multiDay = {
      ...VALID_ITINERARY,
      days: [
        ...VALID_ITINERARY.days,
        { dayIndex: 1, theme: '文化探索', blocks: [{ start: '09:00', end: '17:00', title: '灵隐寺', type: 'sight', why: '千年古刹' }] },
      ],
    }
    const result = await func({ data: JSON.stringify(multiDay) })
    expect(result).toContain('成功')
    expect(itineraryResult.data?.days).toHaveLength(2)
  })
})

describe('Itinerary tool: error handling', () => {
  it('should return error for invalid JSON', async () => {
    const result = await func({ data: 'this is not json' })
    expect(result).toContain('JSON 解析失败')
    expect(itineraryResult.data).toBeNull()
  })

  it('should return error for missing meta.city', async () => {
    const invalid = { meta: { days: 1 }, days: [] }
    const result = await func({ data: JSON.stringify(invalid) })
    expect(result).toContain('格式不完整')
    expect(itineraryResult.data).toBeNull()
  })

  it('should return error for missing days array', async () => {
    const invalid = { meta: { city: '杭州' } }
    const result = await func({ data: JSON.stringify(invalid) })
    expect(result).toContain('格式不完整')
    expect(itineraryResult.data).toBeNull()
  })

  it('should return error for empty data string', async () => {
    const result = await func({ data: '' })
    expect(result).toContain('JSON 解析失败')
  })
})

import { describe, it, expect } from 'vitest'
import { poisTool } from '../../src/tools/pois'

/**
 * POI tool regression tests.
 *
 * The tool uses a hardcoded POI database (no external deps).
 * Covers: city filtering, category filtering, keyword search, edge cases.
 */

const func = poisTool.func

describe('POI tool: city filtering', () => {
  it('should return POIs for 杭州', async () => {
    const result = await func({ city: '杭州', category: 'all', queries: [] })
    expect(result).toContain('杭州')
    expect(result).toContain('西湖')
    expect(result).toContain('楼外楼')
    expect(result).toContain('西湖银泰城')
  })

  it('should return POIs for 成都', async () => {
    const result = await func({ city: '成都', category: 'all', queries: [] })
    expect(result).toContain('成都')
    expect(result).toContain('大熊猫')
    expect(result).toContain('小龙坎')
  })

  it('should return an error for unsupported city', async () => {
    const result = await func({ city: '未知城市', category: 'all', queries: [] })
    expect(result).toContain('暂未收录')
    expect(result).toContain('未知城市')
  })
})

describe('POI tool: category filtering', () => {
  it('should filter by attraction', async () => {
    const result = await func({ city: '杭州', category: 'attraction', queries: [] })
    expect(result).toContain('[景点]')
    expect(result).not.toContain('[餐饮]')
    expect(result).not.toContain('[购物]')
  })

  it('should filter by restaurant', async () => {
    const result = await func({ city: '杭州', category: 'restaurant', queries: [] })
    expect(result).toContain('[餐饮]')
    expect(result).not.toContain('[景点]')
  })

  it('should filter by shopping', async () => {
    const result = await func({ city: '杭州', category: 'shopping', queries: [] })
    expect(result).toContain('[购物]')
    expect(result).not.toContain('[景点]')
  })

  it('should return all categories when set to all', async () => {
    const result = await func({ city: '北京', category: 'all', queries: [] })
    expect(result).toContain('[景点]')
    expect(result).toContain('[餐饮]')
  })
})

describe('POI tool: keyword search', () => {
  it('should filter by keyword matching name', async () => {
    const result = await func({ city: '杭州', category: 'all', queries: ['西湖'] })
    expect(result).toContain('西湖')
    expect(result).not.toContain('灵隐寺')
  })

  it('should return multiple matches for broad keyword', async () => {
    const result = await func({ city: '成都', category: 'all', queries: ['火锅'] })
    expect(result).toContain('小龙坎')
  })

  it('should return empty message when no match', async () => {
    const result = await func({ city: '杭州', category: 'all', queries: ['不存在的关键词'] })
    expect(result).toContain('未找到匹配')
  })
})

describe('POI tool: edge cases', () => {
  it('should handle null queries', async () => {
    const result = await func({ city: '杭州', category: 'all', queries: null })
    expect(result).toContain('西湖')
    expect(result).toContain('楼外楼')
  })

  it('should handle empty category as all', async () => {
    // @ts-expect-error testing default behaviour
    const result = await func({ city: '杭州', category: undefined, queries: [] })
    expect(result).toContain('西湖')
    expect(result).toContain('楼外楼')
  })
})

import { describe, it, expect } from 'vitest'
import { routeTool } from '../../src/tools/route'

/**
 * Route tool regression tests.
 *
 * The tool uses a hardcoded route map (no external deps).
 * Covers: known routes, reverse lookup, unknown routes, transport modes.
 */

const func = routeTool.func

describe('Route tool: known routes', () => {
  it('should return route info for a known origin-destination pair', async () => {
    const result = await func({
      city: '杭州',
      routes: [{ origin: '西湖', destination: '灵隐寺', mode: 'transit' }],
    })
    expect(result).toContain('西湖')
    expect(result).toContain('灵隐寺')
    expect(result).toContain('公交')
    expect(result).toContain('40分钟')
  })

  it('should return walking info for short distance', async () => {
    const result = await func({
      city: '成都',
      routes: [{ origin: '锦里', destination: '武侯祠', mode: 'walking' }],
    })
    expect(result).toContain('步行')
    expect(result).toContain('5分钟')
  })
})

describe('Route tool: reverse lookup', () => {
  it('should resolve destination-origin when origin-destination not found', async () => {
    // ROUTES has '西湖-灵隐寺' but not '灵隐寺-西湖'
    const result = await func({
      city: '杭州',
      routes: [{ origin: '灵隐寺', destination: '西湖', mode: 'transit' }],
    })
    expect(result).toContain('灵隐寺')
    expect(result).toContain('西湖')
    expect(result).toContain('公交')
  })
})

describe('Route tool: unknown routes', () => {
  it('should return generic suggestion for unknown route', async () => {
    const result = await func({
      city: '杭州',
      routes: [{ origin: '西湖', destination: '未知地点', mode: 'transit' }],
    })
    expect(result).toContain('西湖')
    expect(result).toContain('未知地点')
    expect(result).toContain('公共交通')
  })
})

describe('Route tool: transport modes', () => {
  it('should return transit info', async () => {
    const result = await func({
      city: '北京',
      routes: [{ origin: '天安门', destination: '颐和园', mode: 'transit' }],
    })
    expect(result).toContain('地铁')
  })

  it('should return driving info', async () => {
    const result = await func({
      city: '北京',
      routes: [{ origin: '天安门', destination: '颐和园', mode: 'driving' }],
    })
    expect(result).toContain('14公里')
  })

  it('should fallback to transit for long-distance walking', async () => {
    const result = await func({
      city: '上海',
      routes: [{ origin: '外滩', destination: '迪士尼', mode: 'walking' }],
    })
    expect(result).toContain('不建议步行')
  })
})

describe('Route tool: batch routing', () => {
  it('should plan multiple routes in one call', async () => {
    const result = await func({
      city: '杭州',
      routes: [
        { origin: '西湖', destination: '灵隐寺', mode: 'transit' },
        { origin: '西湖', destination: '河坊街', mode: 'walking' },
      ],
    })
    // Should contain info for both routes
    expect(result).toContain('西湖')
    expect(result).toContain('灵隐寺')
    expect(result).toContain('河坊街')
  })
})

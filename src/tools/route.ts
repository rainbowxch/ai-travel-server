import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { config } from '../config.js'

const AMAP_BASE = 'https://restapi.amap.com/v3'

/** Geocode a place name to "lng,lat" via 高德. Returns null on failure. */
async function geocode(address: string, city: string): Promise<string | null> {
  const params = new URLSearchParams({ key: config.amapKey, address, city })
  try {
    const resp = await fetch(`${AMAP_BASE}/geocode/geo?${params}`)
    const body = await resp.json() as any
    if (body.status === '1' && body.geocodes?.length > 0) {
      return body.geocodes[0].location as string
    }
    return null
  } catch {
    return null
  }
}

export const routeTool = new DynamicStructuredTool({
  name: 'plan_route',
  description: '规划城市内两点之间的交通路线，返回建议交通方式、耗时和距离。一次可传入 routes 数组批量规划多条路线。',
  schema: z.object({
    city: z.string().describe('所在城市'),
    routes: z.array(z.object({
      origin: z.string().describe('起点'),
      destination: z.string().describe('终点'),
      mode: z.enum(['transit', 'driving', 'walking']).describe('交通方式'),
    })).describe('多条路线，一次性规划避免多次调用'),
  }),
  func: async ({ city, routes }) => {
    if (!config.amapKey) {
      return '未配置高德地图 API Key（AMAP_API_KEY）。请在 .env 中配置，到 https://lbs.amap.com/ 注册免费 Key。'
    }

    if (!routes.length) return '没有需要规划的路线。'

    // Batch-geocode all unique origin/destination names
    const uniquePlaces = [...new Set(routes.flatMap(r => [r.origin, r.destination]))]
    const geoCache = new Map<string, string | null>()
    for (const place of uniquePlaces) {
      geoCache.set(place, await geocode(place, city))
    }

    const modeLabel = { transit: '公共交通', driving: '驾车', walking: '步行' }

    const results: string[] = []
    for (const { origin, destination, mode } of routes) {
      const originLoc = geoCache.get(origin)
      const destLoc = geoCache.get(destination)

      if (!originLoc || !destLoc) {
        // Fallback: give a reasonable city-level estimate so the agent doesn't retry
        const estimate = mode === 'walking'
          ? '步行约20-40分钟'
          : mode === 'driving'
            ? '驾车约15-30分钟'
            : '公共交通约30-60分钟'
        results.push(`从 ${origin} 到 ${destination}（${modeLabel[mode]}）：${estimate}（因无法获取精确位置，此为城市范围估算）`)
        continue
      }

      const params = new URLSearchParams({
        key: config.amapKey,
        origin: originLoc,
        destination: destLoc,
      })
      if (mode === 'transit') {
        params.set('city', city)
        params.set('cityd', city)
      }

      const endpoint = mode === 'transit'
        ? `${AMAP_BASE}/direction/transit/integrated`
        : mode === 'driving'
          ? `${AMAP_BASE}/direction/driving`
          : `${AMAP_BASE}/direction/walking`

      try {
        const resp = await fetch(`${endpoint}?${params}`)
        const body = await resp.json() as any

        if (body.status !== '1') {
          results.push(`从 ${origin} 到 ${destination}（${modeLabel[mode]}）：路线规划失败`)
          continue
        }

        let duration = ''
        let distance = ''
        let detail = ''

        if (mode === 'transit' && body.route?.transits?.length > 0) {
          const t = body.route.transits[0]
          const min = Math.round(parseInt(t.duration || '0') / 60)
          duration = `约${min}分钟`
          const km = parseInt(t.distance || '0') / 1000
          distance = `${km.toFixed(1)}km`
          if (t.cost?.total_price && parseInt(t.cost.total_price) > 0) {
            distance += `，票价¥${t.cost.total_price}`
          }
          // Build a short route description from segments
          const segParts: string[] = []
          for (const seg of t.segments ?? []) {
            if (seg.walking && parseInt(seg.walking.distance || '0') > 100) {
              segParts.push(`步行${Math.round(parseInt(seg.walking.distance) / 100) / 10}km`)
            } else if (seg.bus?.buslines?.length) {
              const bus = seg.bus.buslines[0]
              segParts.push(bus.name)
            }
          }
          if (segParts.length) detail = segParts.join(' → ')
        } else if (body.route?.paths?.length > 0) {
          const p = body.route.paths[0]
          const min = Math.round(parseInt(p.duration || '0') / 60)
          duration = `约${min}分钟`
          const km = parseInt(p.distance || '0') / 1000
          distance = `${km.toFixed(1)}km`
          if (mode === 'driving' && p.tolls) {
            distance += `，过路费¥${p.tolls}`
          }
        }

        const lines = [`从 ${origin} 到 ${destination}（${modeLabel[mode]}）：`]
        if (duration) lines.push(`  耗时${duration}`)
        if (distance) lines.push(`  距离${distance}`)
        if (detail) lines.push(`  路线：${detail}`)
        results.push(lines.join('\n'))
      } catch {
        results.push(`从 ${origin} 到 ${destination}（${modeLabel[mode]}）：路线规划失败`)
      }
    }

    return results.join('\n\n')
  },
})

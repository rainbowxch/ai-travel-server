import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { config } from '../config.js'

const AMAP_BASE = 'https://restapi.amap.com/v3'

const CATEGORY_TYPES: Record<'attraction' | 'restaurant' | 'shopping', string> = {
  attraction: '110000',
  restaurant: '050000',
  shopping: '060000',
}

const CATEGORY_LABEL: Record<'attraction' | 'restaurant' | 'shopping', string> = {
  attraction: '景点',
  restaurant: '餐厅',
  shopping: '购物',
}

export const poisTool = new DynamicStructuredTool({
  name: 'search_pois',
  description: '搜索某城市的景点、餐厅、购物等兴趣点。用 category=all 一次搜索全部类别，queries 可传多个关键词。',
  schema: z.object({
    city: z.string().describe('城市名称'),
    category: z.enum(['attraction', 'restaurant', 'shopping', 'all']).describe('兴趣点类别，用"all"一次获取全部'),
    queries: z.array(z.string()).nullable().optional().describe('多个搜索关键词，一次搜索多个兴趣点'),
  }),
  func: async ({ city, category, queries }) => {
    if (!config.amapKey) {
      return '未配置高德地图 API Key（AMAP_API_KEY）。请在 .env 中配置，到 https://lbs.amap.com/ 注册免费 Key。'
    }

    const keywords = queries?.filter(Boolean) ?? []

    if (keywords.length > 0) {
      // Search each keyword independently and merge results
      const results: string[] = [`${city} 兴趣点搜索结果：`]
      for (const kw of keywords) {
        const params = new URLSearchParams({
          key: config.amapKey,
          keywords: kw,
          city,
          offset: '10',
          page: '1',
        })
        if (category !== 'all') params.set('types', CATEGORY_TYPES[category])

        try {
          const resp = await fetch(`${AMAP_BASE}/place/text?${params}`)
          const body = await resp.json() as any
          if (body.status === '1' && body.pois?.length > 0) {
            for (const poi of body.pois) {
              const parts = [`- ${poi.name}`]
              if (poi.address) parts.push(`（${poi.address}）`)
              const subType = poi.type?.split(';')?.pop() ?? ''
              if (subType) parts.push(`[${subType}]`)
              results.push(parts.join(' '))
            }
          } else {
            results.push(`未找到"${kw}"相关结果`)
          }
        } catch {
          results.push(`搜索"${kw}"时出错`)
        }
      }
      return results.join('\n')
    }

    // No specific keywords — browse by category in the city
    const params = new URLSearchParams({
      key: config.amapKey,
      city,
      offset: '20',
      page: '1',
    })
    if (category !== 'all') {
      params.set('types', CATEGORY_TYPES[category])
    } else {
      params.set('types', '110000|050000|060000')
    }

    try {
      const resp = await fetch(`${AMAP_BASE}/place/text?${params}`)
      const body = await resp.json() as any
      if (body.status !== '1' || !body.pois?.length) {
        return `在"${city}"未找到相关${category !== 'all' ? CATEGORY_LABEL[category] : 'POI'}。`
      }

      const label = category !== 'all' ? CATEGORY_LABEL[category] : '兴趣点'
      const results = [`${city} ${label}推荐：`]
      for (const poi of body.pois.slice(0, 20)) {
        const parts = [`- ${poi.name}`]
        if (poi.address) parts.push(`（${poi.address}）`)
        const subType = poi.type?.split(';')?.pop() ?? ''
        if (subType) parts.push(`[${subType}]`)
        results.push(parts.join(' '))
      }
      return results.join('\n')
    } catch (e) {
      return `搜索"${city}" POI 失败：${(e as Error).message}`
    }
  },
})

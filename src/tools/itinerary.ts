import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Itinerary } from '../types.js'

/** Strip markdown code fences from a string so we can JSON.parse it. */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim()
}

/** Shared mutable holder — set when the agent calls generate_itinerary. */
export const itineraryResult: { data: Itinerary | null } = { data: null }

export const generateItineraryTool = new DynamicStructuredTool({
  name: 'generate_itinerary',
  description: '根据已获取的天气、景点、路线等真实数据，生成最终完整行程。调用此工具即代表行程已准备就绪。参数 data 为完整行程的 JSON 字符串。',
  schema: z.object({
    data: z.string().describe('完整行程 JSON，格式：{"meta":{"city":"城市","days":天数,"summary":"概述","budgetTotal":预算,"constraints":["假设1"],"dates":"出行日期如五一/2025-10-01","peopleCount":"人数如3人/2大1小"},"days":[{"dayIndex":0,"theme":"主题","blocks":[{"start":"HH:MM","end":"HH:MM","title":"活动","type":"sight|food|transport|rest|shopping","why":"理由","costEstimate":费用,"tips":["提示1"],"openingHours":"开放时间（景点类型填写）","activities":["活动项目1","活动项目2"]}]}]}'),
  }),
  func: async ({ data }) => {
    const cleaned = stripCodeFences(data)
    let parsed: Itinerary
    try {
      parsed = JSON.parse(cleaned) as Itinerary
    } catch (e) {
      return `JSON 解析失败，请修正后重试：${(e as Error)?.message ?? '格式错误'}`
    }
    if (!parsed.meta?.city || !Array.isArray(parsed.days)) {
      return '行程数据格式不完整：需要包含 meta.city 和 days 数组，请补全后重试。'
    }
    itineraryResult.data = parsed
    return '行程已成功生成并保存。'
  },
})

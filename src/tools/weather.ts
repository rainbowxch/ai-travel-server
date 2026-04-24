import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

const WMO_CODES: Record<number, string> = {
  0: '晴天', 1: '大部晴', 2: '多云', 3: '阴天',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  80: '小阵雨', 81: '中阵雨', 82: '大阵雨',
  95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴大冰雹',
}

export const weatherTool = new DynamicStructuredTool({
  name: 'get_weather',
  description: '获取某城市在指定日期的天气预报。一次可传入 dates 数组批量查询多天。',
  schema: z.object({
    city: z.string().describe('城市名称，如"杭州"'),
    dates: z.array(z.string()).describe('日期列表，多个日期一次性查询。格式 YYYY-MM-DD'),
  }),
  func: async ({ city, dates }) => {
    /* ── Geo lookup ── */
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=3&language=zh`
    const geoResp = await fetch(geoUrl)
    if (!geoResp.ok) throw new Error(`地理编码请求失败: ${geoResp.status}`)
    const geoJson = await geoResp.json() as any
    const results = geoJson?.results
    if (!Array.isArray(results) || results.length === 0) {
      return `未找到城市"${city}"的坐标信息。`
    }
    const loc = results[0]!
    const lat = loc.latitude as number
    const lng = loc.longitude as number

    /* ── Weather forecast ── */
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=16`
    const weatherResp = await fetch(weatherUrl)
    if (!weatherResp.ok) throw new Error(`天气请求失败: ${weatherResp.status}`)
    const weatherJson = await weatherResp.json() as any
    const daily = weatherJson?.daily
    if (!daily) return `无法获取"${city}"的天气预报。`

    const timeArr = daily.time as string[]
    const summary = [`${city}（${loc.name ?? ''}，${loc.country ?? ''}）天气预报`]
    let anyMatched = false

    for (const date of dates) {
      const idx = timeArr.indexOf(date)
      if (idx === -1) continue
      anyMatched = true
      summary.push(`\n${date} 预报：`)
      appendDay(summary, daily, idx)
    }

    if (!anyMatched) {
      summary.push(`\n查询日期（${dates.join(', ')}）均不在预报范围内（可查 ${timeArr[0] ?? '?'} ~ ${timeArr[timeArr.length - 1] ?? '?'}）。`)
      summary.push('\n未来几天概况：')
      for (let i = 0; i < Math.min(timeArr.length, 5); i++) {
        appendDay(summary, daily, i)
      }
    }

    return summary.join('\n')
  },
})

function appendDay(lines: string[], daily: any, i: number) {
  const code = daily.weather_code[i] as number ?? 0
  const condition = WMO_CODES[code] ?? `未知(${code})`
  lines.push(
    `  ${daily.time[i]} | ${daily.temperature_2m_min[i]}~${daily.temperature_2m_max[i]}°C | ${condition} | 降水概率 ${daily.precipitation_probability_max[i] ?? '-'}%`
  )
}

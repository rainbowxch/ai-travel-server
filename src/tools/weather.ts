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

/** Shift a YYYY-MM-DD date back by one year. */
function prevYear(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().split('T')[0] ?? dateStr
}

/** Format a single forecast day line. */
function fmtForecast(daily: any, i: number): string {
  const code = daily.weather_code[i] as number ?? 0
  const condition = WMO_CODES[code] ?? `未知(${code})`
  return `  ${daily.time[i]} | ${daily.temperature_2m_min[i]}~${daily.temperature_2m_max[i]}°C | ${condition} | 降水概率 ${daily.precipitation_probability_max[i] ?? '-'}%`
}

/** Format a single archive (historical) day line. */
function fmtArchive(arch: any, i: number, date: string): string {
  const tMin = arch.daily.temperature_2m_min[i]
  const tMax = arch.daily.temperature_2m_max[i]
  const precip = arch.daily.precipitation_sum[i]
  return `  ${date} | ${tMin}~${tMax}°C | 降水 ${precip ?? '-'}mm (历史同期数据)`
}

export const weatherTool = new DynamicStructuredTool({
  name: 'get_weather',
  description: '获取某城市在指定日期的天气预报。优先返回数值预报，超出预报范围则返回历史同期气候参考数据。一次可传入 dates 数组批量查询多天。',
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
    const locationLabel = `${city}（${loc.name ?? ''}，${loc.country ?? ''}）`

    /* ── 16-day forecast ── */
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=16`
    const fResp = await fetch(forecastUrl)
    if (!fResp.ok) throw new Error(`天气请求失败: ${fResp.status}`)
    const fJson = await fResp.json() as any
    const fDaily = fJson?.daily
    if (!fDaily) return `无法获取"${city}"的天气预报。`
    const fDates = new Set(fDaily.time as string[])

    /* Separate dates into forecast (within 16 days) and climate (beyond) */
    const forecastDates: string[] = []
    const climateDates: string[] = []
    for (const d of dates) {
      if (fDates.has(d)) forecastDates.push(d)
      else climateDates.push(d)
    }

    const lines: string[] = [`${locationLabel}天气`]
    let hasData = false

    /* ── Forecast data ── */
    if (forecastDates.length > 0) {
      hasData = true
      lines.push(`\n【数值预报】`)
      for (const date of forecastDates) {
        const idx = (fDaily.time as string[]).indexOf(date)
        if (idx !== -1) { lines.push(fmtForecast(fDaily, idx)); hasData = true }
      }
    }

    /* ── Climate archive fallback (historical data from last year) ── */
    if (climateDates.length > 0) {
      const start = prevYear(climateDates[0]!)
      const end = prevYear(climateDates[climateDates.length - 1]!)
      const archUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
      try {
        const aResp = await fetch(archUrl)
        if (aResp.ok) {
          const aJson = await aResp.json() as any
          const aDaily = aJson?.daily
          if (aDaily && Array.isArray(aDaily.time)) {
            hasData = true
            lines.push(`\n【历史同期参考（去年同期数据）】`)
            for (const date of climateDates) {
              const prev = prevYear(date)
              const idx = (aDaily.time as string[]).indexOf(prev)
              if (idx !== -1) lines.push(fmtArchive(aJson, idx, date))
            }
          }
        }
      } catch {
        // Archive API failure — skip, don't fail the whole tool
      }
    }

    /* ── Show nearest available days as reference if nothing matched ── */
    if (!hasData) {
      lines.push(`\n查询日期（${dates.join(', ')}）暂无可用的预报或历史数据。`)
      lines.push(`\n${locationLabel}近期天气参考：`)
      for (let i = 0; i < Math.min((fDaily.time as string[]).length, 5); i++) {
        lines.push(fmtForecast(fDaily, i))
      }
    }

    return lines.join('\n')
  },
})

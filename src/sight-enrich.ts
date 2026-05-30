import { ChatOpenAI } from '@langchain/openai'
import { config } from './config.js'

/** In-memory cache for enriched sight data */
const enrichCache = new Map<string, SightEnrichResult>()

export interface SightEnrichResult {
  overview: string
  history: string
  culture: string
  stories: string
  highlights: string
  practical: string
}

function cacheKey(title: string, city: string): string {
  return `${city}:${title}`
}

/** Singleton LLM for enrichment — lower temperature for factual output */
const enrichLlm = new ChatOpenAI({
  modelName: config.model,
  temperature: 0.3,
  timeout: 30_000,
  configuration: {
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  },
})

const ENRICH_PROMPT = `你是一个专业的旅游景点知识库。请根据景点名称和所在城市，生成该景点的详细介绍。

请用中文返回一个 JSON 对象，包含以下字段：
- overview: 景点概述（100-150字，介绍景点位置、地位、整体特色）
- history: 历史文化（150-250字，介绍历史沿革、文化背景、建筑特色等）
- culture: 人文特色（100-150字，介绍当地民俗、艺术、文化氛围等）
- stories: 名人故事与传说（150-250字，介绍相关历史人物、名人轶事、民间传说等）
- highlights: 亮点特色（100-150字，介绍必看亮点、最佳拍照点、特色体验等）
- practical: 游览建议（100-150字，介绍最佳游览路线、注意事项、周边配套等）

要求：
1. 内容必须基于真实历史和文化信息，不要编造
2. 如果是不知名的景点，可以适当概括，但不要虚构细节
3. 语言生动自然，适合旅行者阅读
4. 直接输出 JSON，不要 markdown 代码块标记

景点名称：{title}
所在城市：{city}`

export async function enrichSight(title: string, city: string): Promise<SightEnrichResult> {
  const key = cacheKey(title, city)
  const cached = enrichCache.get(key)
  if (cached) return cached

  const prompt = ENRICH_PROMPT.replace('{title}', title).replace('{city}', city)

  try {
    const res = await enrichLlm.invoke(prompt)
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
    // Try to parse JSON from the response — handle markdown-wrapped JSON too
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const jsonStr = jsonMatch?.[0] ?? text
    const data = JSON.parse(jsonStr) as SightEnrichResult

    const result: SightEnrichResult = {
      overview: data.overview || `${title}位于${city}，是一处值得游览的景点。`,
      history: data.history || `${title}拥有丰富的历史文化底蕴，是了解${city}人文风貌的好去处。`,
      culture: data.culture || `${city}地区有着独特的地方文化，融合了传统与现代元素。`,
      stories: data.stories || `历代文人墨客曾游历${title}，留下了许多动人的故事和诗篇。`,
      highlights: data.highlights || `${title}的精华在于其独特的建筑风格和自然景观，值得细细品味。`,
      practical: data.practical || `建议安排1-2小时游览，提前查看开放时间，合理安排行程。`,
    }

    enrichCache.set(key, result)
    return result
  } catch (e) {
    console.error(`[sight-enrich] LLM error for ${title}:`, (e as Error).message)
    // Fallback: return generated content based on title + city
    return generateFallback(title, city)
  }
}

function generateFallback(title: string, city: string): SightEnrichResult {
  return {
    overview: `${title}位于${city}，是该地区著名的旅游景点，以其独特的自然风光和人文景观吸引着众多游客。`,
    history: `${title}拥有悠久的历史，作为${city}的重要文化地标，见证了这座城市的发展变迁。景区内的古建筑和文物遗迹，向人们诉说着过往的故事。`,
    culture: `${city}地区文化底蕴深厚，传统与现代在这里完美融合。${title}周边的民俗活动和非物质文化遗产，为游客提供了深入了解当地文化的机会。`,
    stories: `历史上，${title}曾吸引众多文人墨客前来游览，他们留下的诗词歌赋为这里增添了浓厚的人文气息。民间也流传着许多关于${title}的美丽传说。`,
    highlights: `${title}的精华景点包括主景区、观景台和文化展览馆。建议游客在游览时留意景区的标志性建筑和特色景观，这些都是拍照留念的好地方。`,
    practical: `建议游览时间：1-2小时。最佳季节：春秋两季。注意事项：节假日游客较多，建议错峰出行；穿着舒适的鞋子；注意保护环境。`,
  }
}

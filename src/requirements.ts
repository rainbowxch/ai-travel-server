import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { config } from './config.js'

export interface TravelRequirements {
  destination: string | null
  peopleCount: string | null
  budget: string | null
  duration: number | null
  dates: string | null
  departureCity: string | null
  preferences: string[]
}

export interface RequirementCheckResult {
  complete: boolean
  requirements: TravelRequirements
  flexibleFields: string[]
  question: string
}

const FIELD_LABELS: Record<string, string> = {
  destination: '目的地',
  peopleCount: '出行人数',
  duration: '游玩天数',
  dates: '出行日期',
}

const EXTRACTION_PROMPT = `你是一个旅行规划需求分析器。分析对话并提取用户的旅行规划需求。

首先判断用户是否在讨论旅行规划相关的内容（包括修改已有行程、询问旅行建议等）。

然后提取以下信息（budget可选，用户没提就不要问。只从用户的发言中提取，不要从助手的发言中提取）：
1. destination - 目的地（城市或地区名称）
2. peopleCount - 出行人数（如"2大1小"、"3人"、"一个人"）
3. budget - 预算（可选，用户没说就不需要问。用字符串，如"5000"表示总共5000元，"每人3000"表示人均）
4. duration - 游玩天数（用数字，如3表示3天）
5. dates - 出行日期（如"五一"、"下周末"、"2026-05-01"）
6. departureCity - 出发城市
7. preferences - 偏好列表，如["轻松","不赶","美食","带小孩","穷游","深度游","购物"]

重要：判断用户是否对某个信息明确表达了"都可以/无所谓/随便/不限/你看着办"的态度。
例如：
- "预算多少都可以" → 加入 flexibleFields
- "哪里都行"、"随便去哪" → 加入 flexibleFields
- "都行，你看着安排" → 所有字段都加入 flexibleFields
- "人数不限" → 加入 flexibleFields
- "什么时候都行" → 加入 flexibleFields

以严格的JSON格式输出，只输出JSON，不要任何其他内容：
{
  "isTravelRelated": true,
  "requirements": {
    "destination": null,
    "peopleCount": null,
    "budget": null,
    "duration": null,
    "dates": null,
    "departureCity": null,
    "preferences": []
  },
  "flexibleFields": [],
  "question": "如果用户明确表达了无所谓，不要问。如果isTravelRelated为true，用自然语言询问缺失的、且用户没有说无所谓的信息。已提供的信息先确认，再询问缺失的。如果所有缺失信息都是无所谓的，question设为空字符串。如果isTravelRelated为false，question设为空字符串"
}`

/**
 * Check whether all 5 required travel-planning fields have been provided
 * in the conversation history. If the user explicitly says 都可以/无所谓
 * for a field, that field is considered satisfied and won't be asked again.
 */
export async function checkRequirements(
  chatHistory: Array<{ role: string; content: string }>,
): Promise<RequirementCheckResult> {
  const llm = new ChatOpenAI({
    modelName: config.model,
    temperature: 0.1,
    configuration: {
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    },
  })

  const conversation = chatHistory
    .map(m => `${m.role === 'human' ? '用户' : '助手'}: ${m.content}`)
    .join('\n')

  try {
    const result = await llm.invoke(
      [
        new SystemMessage(EXTRACTION_PROMPT),
        new HumanMessage(conversation),
      ],
      { response_format: { type: 'json_object' } },
    )

    const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
    const parsed = JSON.parse(content) as {
      isTravelRelated: boolean
      requirements: TravelRequirements
      flexibleFields: string[]
      question: string
    }

    // Non-travel messages (greetings, etc.) → skip requirement check, let agent handle
    if (parsed.isTravelRelated === false) {
      return {
        complete: true,
        requirements: parsed.requirements,
        flexibleFields: [],
        question: '',
      }
    }

    const req = parsed.requirements
    const flexible = parsed.flexibleFields ?? []

    // Normalise & validate fields
    const destination = req.destination?.trim() || null
    const peopleCount = req.peopleCount?.trim() || null
    const budget = req.budget?.trim() || null
    const duration = typeof req.duration === 'number' && !isNaN(req.duration) ? req.duration : null
    const dates = req.dates?.trim() || null
    const departureCity = req.departureCity?.trim() || null
    const preferences = Array.isArray(req.preferences) ? req.preferences as string[] : []

    const normalized: TravelRequirements = { destination, peopleCount, budget, duration, dates, departureCity, preferences }

    // A field is "missing" only if not provided AND not marked as flexible
    const missingFields: string[] = []
    if (!destination && !flexible.includes('destination')) missingFields.push('destination')
    if (!peopleCount && !flexible.includes('peopleCount')) missingFields.push('peopleCount')
    if (duration === null && !flexible.includes('duration')) missingFields.push('duration')
    if (!dates && !flexible.includes('dates')) missingFields.push('dates')

    if (missingFields.length === 0) {
      // All fields satisfied (either provided or user said 无所谓)
      return { complete: true, requirements: normalized, flexibleFields: flexible, question: '' }
    }

    // Use LLM-generated question, or build a fallback
    let question = parsed.question?.trim() || ''
    if (!question) {
      const missing = missingFields.map(f => FIELD_LABELS[f] || f).join('、')
      question = `好的，我来帮您规划旅行！还需要了解以下信息：${missing}。请告诉我吧～`
    }

    return { complete: false, requirements: normalized, flexibleFields: flexible, question }
  } catch (err) {
    // If extraction fails (network / parse error), let the agent handle it
    console.warn('[requirements] extraction failed, proceeding to agent:', (err as Error)?.message)
    return {
      complete: true,
      requirements: { destination: null, peopleCount: null, budget: null, duration: null, dates: null, departureCity: null, preferences: [] },
      flexibleFields: [],
      question: '',
    }
  }
}

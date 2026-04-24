import { ChatOpenAI } from '@langchain/openai'
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { type DynamicStructuredTool } from '@langchain/core/tools'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { config } from './config.js'
import { weatherTool } from './tools/weather.js'
import { poisTool } from './tools/pois.js'
import { routeTool } from './tools/route.js'
import { generateItineraryTool, itineraryResult } from './tools/itinerary.js'
import type { AgentStep } from './types.js'

const tools: DynamicStructuredTool[] = [
  weatherTool,
  poisTool,
  routeTool,
  generateItineraryTool,
]

const SYSTEM_PROMPT = [
  '你是一个"AI旅行规划助手"。',
  '目标：根据用户约束产出可执行、节奏合理、预算可控的行程。',
  '',
  '你有以下工具可用，请优先使用工具获取真实数据：',
  '  1. get_weather - 获取城市天气预报（温度、天气状况、降水概率）',
  '  2. search_pois - 搜索景点、餐厅、购物等兴趣点',
  '  3. plan_route - 规划市内交通路线和耗时',
  '  4. generate_itinerary - 数据收集完成后，调用此工具输出最终行程',
  '',
  '使用工具时的要求：',
  '- 如果用户输入与旅行规划无关（如问候、闲聊、非旅行问题），不要调用任何工具，直接回复文本。',
  '- 对行程中每一天，先查天气，再根据天气安排户外/室内活动。',
  '- 安排景点和餐厅时先搜索 POI，不要凭空编造。',
  '- 块之间移动时，先查路线以确认耗时合理。',
  '- 善用批量参数，每个工具只调用一次：查询多天天气用 dates 数组传入多个日期；搜索兴趣点用 category=all 和 queries 数组；规划多条路线用 routes 数组。',
  '- 所有工具都提供信息后，再调用 generate_itinerary 输出最终行程。',
  '',
  '输出方式：',
  '- 所有数据收集完成后，调用 generate_itinerary 输出最终行程。',
  '- 将完整行程拼装成 JSON 字符串传入 data 参数。',
  '- 在所有数据收集完成之前，不要调用 generate_itinerary。',
  '',
  '硬性规则：',
  '- 不确定信息要用合理默认值，并把默认值写在 meta.constraints 中。',
  '- 每天至少包含：1 次正餐、1 次休息/自由活动。',
  '- 时间块不要重叠；块之间假设市内移动 30-60 分钟。',
  '- 预算给出一个"总计估算"，不需要细分明细。',
  '- 如果用户信息非常不足，仍然要给出一个可用的 1 版行程，并在 meta.constraints 里列出做的关键假设。',
].join('\n')

function createLLM() {
  return new ChatOpenAI({
    modelName: config.model,
    temperature: 0.4,
    configuration: {
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    },
  })
}

async function createExecutor() {
  const llm = createLLM()
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ])
  const agent = await createToolCallingAgent({ llm, tools, prompt })
  return new AgentExecutor({
    agent,
    tools,
    maxIterations: 6,
    returnIntermediateSteps: true,
  })
}

export async function runAgent(
  input: string,
  chatHistory: Array<{ role: string; content: string }>,
): Promise<{ response: string; steps: AgentStep[] }> {
  const executor = await createExecutor()
  itineraryResult.data = null

  // Map session messages to LangChain format
  const history = chatHistory.map(m => {
    if (m.role === 'human') return new HumanMessage(m.content)
    if (m.role === 'ai') return new AIMessage(m.content)
    if (m.role === 'system') return new SystemMessage(m.content)
    return new HumanMessage(m.content)
  })

  const result = await executor.invoke({
    input,
    chat_history: history,
  })

  // Extract steps from intermediate steps
  const steps: AgentStep[] =
    result.intermediateSteps?.map((step: any) => {
      const agentStep: AgentStep = {
        tool: step.action?.tool ?? 'unknown',
        status: step.error ? 'error' : 'done',
        args: typeof step.action?.toolInput === 'string' ? step.action.toolInput : JSON.stringify(step.action?.toolInput ?? ''),
        result: step.error ?? (typeof step.observation === 'string' ? step.observation.slice(0, 200) : ''),
      }
      if (step.error) agentStep.error = step.error
      return agentStep
    }) ?? []

  return { response: result.output as string ?? '', steps }
}

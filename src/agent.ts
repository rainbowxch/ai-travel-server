import { ChatOpenAI } from '@langchain/openai'
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { DynamicStructuredTool } from '@langchain/core/tools'
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
  '## 批量调用规则（必须遵守）',
  '每个工具最多只能调用一次，通过批量参数一次性传入所有数据：',
  '  - get_weather: 用 dates 数组一次性传入所有天数，不要分多次查',
  '  - search_pois: 用 queries 数组一次性搜完所有兴趣点',
  '  - plan_route: 用 routes 数组一次性规划所有路线',
  '  - generate_itinerary: 数据收集完成后一次性输出完整行程',
  '',
  '## 可用工具',
  '  1. get_weather - 获取城市天气预报（温度、天气状况、降水概率）',
  '  2. search_pois - 搜索景点、餐厅、购物等兴趣点',
  '  3. plan_route - 规划市内交通路线和耗时',
  '  4. generate_itinerary - 数据收集完成后，调用此工具输出最终行程',
  '',
  '## 工作流程',
  '步骤1: 调用 get_weather（一次性查所有天数）',
  '步骤2: 调用 search_pois（一次性搜所有 POI）',
  '步骤3: 调用 plan_route（一次性规划所有路线）',
  '步骤4: 调用 generate_itinerary（输出最终行程）',
  '',
  '## 硬性规则',
  '- 如果用户输入与旅行规划无关（如问候、闲聊），不要调用任何工具，直接回复文本',
  '- 每天至少包含：1 次正餐、1 次休息/自由活动',
  '- 时间块不要重叠；块之间假设市内移动 30-60 分钟',
  '- 不确定信息用合理默认值，写在 meta.constraints 中',
  '- 用户信息不足时也要给出一个可用版本，在 constraints 中列出假设',
].join('\n')

/** Singleton LLM — CHatOpenAI instance reused across all requests */
const llm = new ChatOpenAI({
  modelName: config.model,
  temperature: 0.4,
  timeout: 90_000,
  configuration: {
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  },
})

/** Singleton prompt template */
const prompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  new MessagesPlaceholder('chat_history'),
  ['human', '{input}'],
  new MessagesPlaceholder('agent_scratchpad'),
])

/** Singleton agent executor — created once, reused for all requests */
let executor: AgentExecutor | null = null

async function getExecutor(): Promise<AgentExecutor> {
  if (!executor) {
    const agent = await createToolCallingAgent({ llm, tools, prompt })
    executor = new AgentExecutor({
      agent,
      tools,
      maxIterations: 4,
      returnIntermediateSteps: true,
    })
  }
  return executor
}

/** Map session messages to LangChain message types */
function toLangChainMessages(chatHistory: Array<{ role: string; content: string }>): BaseMessage[] {
  return chatHistory.map(m => {
    if (m.role === 'human') return new HumanMessage(m.content)
    if (m.role === 'ai') return new AIMessage(m.content)
    if (m.role === 'system') return new SystemMessage(m.content)
    return new HumanMessage(m.content)
  })
}

/** Extract AgentStep[] from intermediate steps */
function extractSteps(intermediateSteps: any[]): AgentStep[] {
  return (intermediateSteps ?? []).map(step => {
    const agentStep: AgentStep = {
      tool: step.action?.tool ?? 'unknown',
      status: step.error ? 'error' : 'done',
      args: typeof step.action?.toolInput === 'string' ? step.action.toolInput : JSON.stringify(step.action?.toolInput ?? ''),
      result: step.error ?? (typeof step.observation === 'string' ? step.observation.slice(0, 200) : ''),
    }
    if (step.error) agentStep.error = step.error
    return agentStep
  })
}

export async function runAgent(
  input: string,
  chatHistory: Array<{ role: string; content: string }>,
  onStep?: (tool: string, status: 'running' | 'done' | 'error', data?: string) => void,
): Promise<{ response: string; steps: AgentStep[] }> {
  const exec = await getExecutor()
  itineraryResult.data = null

  const history = toLangChainMessages(chatHistory)

  // Bind callbacks declaratively via withConfig
  const configuredExec = onStep
    ? exec.withConfig({ callbacks: [createStepHandler(onStep)] })
    : exec

  const result = await configuredExec.invoke({ input, chat_history: history })
  const steps = extractSteps(result.intermediateSteps)

  return { response: (result.output as string) ?? '', steps }
}

/**
 * Create a callback handler that maps LangChain tool lifecycle events
 * to the onStep callback for SSE streaming.
 */
function createStepHandler(onStep: (tool: string, status: 'running' | 'done' | 'error', data?: string) => void) {
  const toolRunMap = new Map<string, string>()

  return {
    handleToolStart: async (
      tool: any,
      _input: any,
      runId: string,
      _parentRunId?: string,
      _tags?: string[],
      _metadata?: Record<string, unknown>,
      runName?: string,
    ) => {
      const name = tool?.name ?? runName ?? 'unknown'
      toolRunMap.set(runId, name)
      const args = typeof _input === 'string' ? _input : JSON.stringify(_input ?? '')
      onStep(name, 'running', args)
    },

    handleToolEnd: async (output: any, runId: string) => {
      const name = toolRunMap.get(runId) ?? 'unknown'
      const result = typeof output === 'string'
        ? output.slice(0, 200)
        : JSON.stringify(output ?? '').slice(0, 200)
      onStep(name, 'done', result)
    },

    handleToolError: async (err: any, runId: string) => {
      const name = toolRunMap.get(runId) ?? 'unknown'
      onStep(name, 'error', err?.message ?? '工具执行失败')
    },
  }
}

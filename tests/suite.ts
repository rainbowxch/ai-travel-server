/**
 * Golden Test Suite — AI Travel Server
 *
 * 覆盖所有 API 端点功能及边缘场景。
 * 每个测试用例包含：名称、描述、请求参数、预期状态码、预期响应体（精确匹配或 LLM 评判）。
 *
 * 运行方式： npx tsx tests/runner.ts
 */

export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export interface TestCase {
  id: string
  group: string
  name: string
  description: string
  method: HttpMethod
  path: string
  /** Headers merged with defaults (Authorization etc.) */
  headers?: Record<string, string>
  body?: unknown
  expectStatus: number
  /**
   * 精确匹配：只检查响应体中指定的字段。
   * 值为 undefined 的键表示该字段不应存在。
   * 支持嵌套路径（如 { itinerary: { meta: { city: '杭州' } } }）。
   */
  expectBody?: Record<string, unknown>
  /**
   * 对响应体进行自定义校验，返回 true 表示通过。
   * 与 expectBody 互斥，优先使用 expectBody。
   */
  expectFn?: (body: unknown) => boolean
  /**
   * LLM 评判指令。当设置此项时，会用 LLM 比对实际响应与预期。
   * 给出具体的评判标准，LLM 返回 0-10 的分数和简要说明。
   */
  llmJudge?: string
  /**
   * 该测试需要先执行 setup 获取动态参数（如 token）。
   * setup 返回的键值对会注入到 path 和 headers 中。
   */
  setupRequired?: string[]
  /** 是否跳过此测试（用于需要手动配置的端点） */
  skip?: boolean
  /**
   * 多轮对话的前置消息（仅对 /api/chat/stream 有效）。
   * 按顺序发送这些消息（消费并丢弃 SSE 响应），
   * 然后再发送 body 中的 message 并校验响应。
   * 每条消息中的 __USER_ID__ 等占位符会被自动注入。
   */
  chatSteps?: { message: string }[]
}

/* ── 测试用常量 ── */

export const TEST_ACCOUNT = `test_${Date.now()}@golden.test`
export const REGISTER_ACCOUNT = `reg_${Date.now() + 1}@golden.test`
export const TEST_PASSWORD = 'testpass123'
export const TEST_NAME = '黄金测试用户'
export const SAMPLE_ITINERARY = {
  meta: {
    city: '杭州',
    days: 2,
    summary: '杭州经典两日游，涵盖西湖、灵隐寺等核心景点',
    budgetTotal: 3000,
    constraints: ['节假日人多，建议提前预约'],
    dates: '五一',
    peopleCount: '2人',
  },
  days: [
    {
      dayIndex: 0,
      theme: '西湖经典一日游',
      blocks: [
        {
          start: '09:00',
          end: '11:30',
          title: '西湖断桥残雪',
          type: 'sight',
          why: '西湖十景之一，白堤起点',
          costEstimate: 0,
          openingHours: '全天开放',
          activities: ['散步', '拍照'],
        },
        {
          start: '12:00',
          end: '13:00',
          title: '楼外楼',
          type: 'food',
          why: '百年老店，品尝正宗杭帮菜',
          costEstimate: 200,
        },
      ],
      notes: ['西湖周边周末交通拥堵，建议地铁出行'],
    },
  ],
}

/* ── Test Cases ── */

export const testCases: TestCase[] = [

  /* ═══════════════════════════════════
     1. 健康检查 & 元信息
     ═══════════════════════════════════ */
  {
    id: 'health-001',
    group: '健康检查',
    name: 'Health Check — 正常返回',
    description: 'GET /api/health 应返回 status: ok',
    method: 'GET',
    path: '/api/health',
    expectStatus: 200,
    expectBody: { status: 'ok' },
  },
  {
    id: 'health-002',
    group: '健康检查',
    name: 'Balance — 返回余额或网关错误',
    description: 'GET /api/balance 返回 DeepSeek 余额信息，或 502 网关错误',
    method: 'GET',
    path: '/api/balance',
    expectStatus: 200,
    llmJudge: '检查响应是否包含 balance_infos 数组或 is_available 布尔值。如果是 502，检查 error 是否为字符串。',
  },

  /* ═══════════════════════════════════
     2. 注册
     ═══════════════════════════════════ */
  {
    id: 'auth-001',
    group: '注册',
    name: 'Register — 正常注册',
    description: '有效参数注册返回 token、userId、account',
    method: 'POST',
    path: '/api/auth/register',
    body: { account: REGISTER_ACCOUNT, password: TEST_PASSWORD, name: TEST_NAME },
    expectStatus: 200,
    expectFn: (body: any) =>
      typeof body.token === 'string' &&
      typeof body.userId === 'string' &&
      body.account === REGISTER_ACCOUNT &&
      body.name === TEST_NAME,
  },
  {
    id: 'auth-002',
    group: '注册',
    name: 'Register — 缺少 account',
    description: '不传 account 返回 400',
    method: 'POST',
    path: '/api/auth/register',
    body: { password: TEST_PASSWORD },
    expectStatus: 400,
    expectBody: { error: '邮箱/手机号必填' },
  },
  {
    id: 'auth-003',
    group: '注册',
    name: 'Register — 密码太短',
    description: '密码少于 6 位返回 400',
    method: 'POST',
    path: '/api/auth/register',
    body: { account: 'shortpw@test.com', password: '123' },
    expectStatus: 400,
    expectBody: { error: '密码至少 6 位' },
  },
  {
    id: 'auth-004',
    group: '注册',
    name: 'Register — 重复注册',
    description: '使用已注册的 account 返回 409',
    method: 'POST',
    path: '/api/auth/register',
    body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
    expectStatus: 409,
    expectBody: { error: '该账号已注册，请直接登录' },
  },

  /* ═══════════════════════════════════
     3. 登录
     ═══════════════════════════════════ */
  {
    id: 'auth-005',
    group: '登录',
    name: 'Login — 正常登录',
    description: '正确账号密码返回 token 和用户信息',
    method: 'POST',
    path: '/api/auth/login',
    body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
    expectStatus: 200,
    expectFn: (body: any) =>
      typeof body.token === 'string' &&
      typeof body.userId === 'string' &&
      body.account === TEST_ACCOUNT,
  },
  {
    id: 'auth-006',
    group: '登录',
    name: 'Login — 密码错误',
    description: '错误密码返回 401',
    method: 'POST',
    path: '/api/auth/login',
    body: { account: TEST_ACCOUNT, password: 'wrongpass' },
    expectStatus: 401,
    expectBody: { error: '密码错误' },
  },
  {
    id: 'auth-007',
    group: '登录',
    name: 'Login — 未注册账号',
    description: '不存在的账号返回 401',
    method: 'POST',
    path: '/api/auth/login',
    body: { account: 'nonexist_黄金测试@test.com', password: TEST_PASSWORD },
    expectStatus: 401,
    expectBody: { error: '账号未注册' },
  },
  {
    id: 'auth-008',
    group: '登录',
    name: 'Login — 缺少参数',
    description: '不传 password 返回 400',
    method: 'POST',
    path: '/api/auth/login',
    body: { account: TEST_ACCOUNT },
    expectStatus: 400,
    expectBody: { error: '账号和密码必填' },
  },

  /* ═══════════════════════════════════
     4. 获取用户信息 (GET /api/auth/me)
     ═══════════════════════════════════ */
  {
    id: 'auth-009',
    group: '用户信息',
    name: '/me — 有效 token',
    description: '携带有效 Bearer token 返回用户信息',
    method: 'GET',
    path: '/api/auth/me',
    setupRequired: ['token'],
    expectStatus: 200,
    expectFn: (body: any) =>
      typeof body.userId === 'string' &&
      body.account === TEST_ACCOUNT,
  },
  {
    id: 'auth-010',
    group: '用户信息',
    name: '/me — 无 token',
    description: '不传 Authorization 返回 401',
    method: 'GET',
    path: '/api/auth/me',
    expectStatus: 401,
    expectBody: { error: '未登录' },
  },
  {
    id: 'auth-011',
    group: '用户信息',
    name: '/me — 无效 token',
    description: '伪造的 token 返回 401',
    method: 'GET',
    path: '/api/auth/me',
    headers: { Authorization: 'Bearer invalid_fake_token_xxx' },
    expectStatus: 401,
  },

  /* ═══════════════════════════════════
     5. 聊天 / 流式 SSE
     ═══════════════════════════════════ */
  {
    id: 'chat-001',
    group: '聊天',
    name: 'Chat Stream — 首轮反问（信息不全）',
    description: '发送简略旅行查询，SSE 应返回追问更多信息的文字回复',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    body: { message: '杭州三日游，预算5000', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应是否包含 event:step 和 event:result。最终 result 的 type 为 "text"，content 应涉及杭州旅行规划相关的追问信息（如人数、出发地、日期等），itinerary 为 null。这是首轮信息不全时的正常追问行为，不要扣分。',
  },
  {
    id: 'chat-006',
    group: '聊天',
    name: 'Chat Stream — 完整信息直接生成行程',
    description: '发送完整旅行信息，SSE 应直接生成行程规划',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    body: { message: '一家三口从上海去杭州玩3天，五一期间，预算5000，帮我规划一下行程', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应。最终 result 的 type 应为 "itinerary"（因为用户提供了人数、出发地、目的地、天数、日期、预算等完整信息）。itinerary 应包含 meta.city 为 "杭州"、meta.days 为 3、meta.peopleCount 不为空。如果 type 为 "text" 说明 LLM 仍在追问，可酌情扣分但不要判失败。',
  },
  {
    id: 'chat-007',
    group: '聊天',
    name: 'Chat Stream — 第二轮补充信息后生成行程',
    description: '先发简略查询再补充信息，第二轮应返回完整行程',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    body: { message: '2人，从上海出发，五一去', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应。因为之前已有对话历史（杭州三日游预算5000），第二轮用户补充了人数和出发地，最终 result 的 type 应为 "itinerary" 或 "text"。如果是 "itinerary"，itinerary 应包含 meta.city 为 "杭州"。type 为 "text" 也视为合理（可能继续追问）。不要因为 type 为 "text" 而判失败。',
  },
  {
    id: 'chat-008',
    group: '聊天',
    name: 'Chat Stream — 空 message',
    description: 'message 为空字符串返回 400',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token'],
    headers: { 'Content-Type': 'application/json' },
    body: { message: '', userId: '__USER_ID__' },
    expectStatus: 400,
    expectBody: { error: 'message 字段必填' },
  },
  {
    id: 'chat-009',
    group: '聊天',
    name: 'Chat Stream — 纯空格 message',
    description: 'message 为纯空格字符，服务端应正常处理',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    headers: { 'Content-Type': 'application/json' },
    body: { message: '   ', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 响应是否正常返回。message 为纯空格字符串，服务端没有拒绝，result 的 type 应为 "text"。',
  },
  {
    id: 'chat-002',
    group: '聊天',
    name: 'Chat Stream — 缺少 message',
    description: '不传 message 返回 400',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token'],
    headers: { 'Content-Type': 'application/json' },
    body: { userId: '__USER_ID__' },
    expectStatus: 400,
    expectBody: { error: 'message 字段必填' },
  },
  {
    id: 'chat-003',
    group: '聊天',
    name: 'Chat Stream — 缺少 userId',
    description: '不传 userId 返回 401',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token'],
    headers: { 'Content-Type': 'application/json' },
    body: { message: 'hello' },
    expectStatus: 401,
    expectBody: { error: 'userId 必填，请先登录' },
  },
  {
    id: 'chat-004',
    group: '聊天',
    name: 'Chat Stream — 无认证',
    description: '不带 token 返回 401',
    method: 'POST',
    path: '/api/chat/stream',
    headers: { 'Content-Type': 'application/json' },
    body: { message: 'hello', userId: 'test' },
    expectStatus: 401,
  },
  {
    id: 'chat-005',
    group: '聊天',
    name: 'Chat Stream — 非旅行类消息',
    description: '发送问候消息，SSE 返回文字回复（非行程）',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    headers: { 'Content-Type': 'application/json' },
    body: { message: '你好，你是谁？', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 响应的最终 result 的 type 是否为 "text"，content 应包含自我介绍（如"AI旅行规划助手"），itinerary 为 null。',
  },
  {
    id: 'chat-010',
    group: '聊天',
    name: 'Chat Stream — 用户说"都可以"直接生成行程',
    description: '信息不全触发追问后，用户回答"都可以"，应直接生成完整行程',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    chatSteps: [
      { message: '杭州去玩3天，预算5000' },
    ],
    body: { message: '都可以，你帮我定', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应。这是两轮对话：用户先问"杭州去玩3天，预算5000"（信息不全），LLM 追问细节，用户回复"都可以，你帮我定"。最终 result 的 type 应为 "itinerary"，itinerary 包含 meta.city 为 "杭州"、meta.days 为 3。这说明 LLM 在用户表示"都可以"时不再追问，直接生成行程。如果 type 为 "text" 说明仍在追问，酌情扣分。',
  },
  {
    id: 'chat-011',
    group: '聊天',
    name: 'Chat Stream — 连续模糊消息触发默认值填充',
    description: '连续发送3条模糊消息，触发 askCount >= 2 后服务端应使用默认值直接生成行程',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    chatSteps: [
      { message: '我想出去玩' },
      { message: '随便去哪都行' },
    ],
    body: { message: '你帮我安排吧', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应。这是三轮对话：用户连续发送模糊消息"我想出去玩"、"随便去哪都行"、"你帮我安排吧"。服务端在前两轮应该追问（askCount < 2），第三轮 askCount >= 2 触发默认值填充，最终 result 的 type 应为 "itinerary"（直接生成默认行程），而不是继续追问。如果 type 为 "text" 酌情扣分。',
  },
  {
    id: 'chat-012',
    group: '聊天',
    name: 'Chat Stream — 长对话触发摘要提取',
    description: '发送多条消息使上下文超过 MAX_VISIBLE_MSGS(6)，触发旧消息自动摘要',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    chatSteps: [
      { message: '你好' },
      { message: '我想去旅游' },
      { message: '帮我推荐个地方' },
      { message: '暖和一点的地方' },
      { message: '预算不要太多' },
      { message: '3天左右吧' },
    ],
    body: { message: '从上海出发，帮我规划一下', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应。这是长对话测试（7轮），旧消息应被自动摘要。最终 result 的 type 应为 "itinerary" 或 "text"。如果生成 itinerary，目的地应为合理城市（用户要求暖和、预算不多、3天、从上海出发）。如果仍在追问，检查是否基于对话历史（而非完全失忆），说明摘要保留了上下文。',
  },
  {
    id: 'chat-013',
    group: '聊天',
    name: 'Chat Stream — 非旅行对话后上下文记忆',
    description: '先问候再问行程，验证上下文记忆正常工作',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    chatSteps: [
      { message: '你好，帮我规划旅行' },
    ],
    body: { message: '杭州3天，预算5000，2个人', userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 流式响应。这是两轮对话：用户先打招呼说想规划旅行，第二轮补充具体信息"杭州3天，预算5000，2个人"。最终 result 的 type 应为 "itinerary"，itinerary 包含 meta.city 为 "杭州"、meta.days 为 3。如果 type 为 "text" 说明仍缺少信息需要追问，可酌情扣分。',
  },

  /* ═══════════════════════════════════
     6. 历史记录
     ═══════════════════════════════════ */
  {
    id: 'history-001',
    group: '历史记录',
    name: 'Get History — 正常获取',
    description: '获取聊天历史，返回 messages 数组',
    method: 'GET',
    path: '/api/history/__USER_ID__',
    setupRequired: ['token', 'userId'],
    expectStatus: 200,
    expectFn: (body: any) =>
      body.userId !== undefined &&
      Array.isArray(body.messages),
  },
  {
    id: 'history-002',
    group: '历史记录',
    name: 'Get History — 无认证',
    description: '不带 token 返回 401',
    method: 'GET',
    path: '/api/history/__USER_ID__',
    expectStatus: 401,
  },
  {
    id: 'history-003',
    group: '历史记录',
    name: 'Get History — 越权访问',
    description: 'A 用户无法访问 B 用户的历史',
    method: 'GET',
    path: '/api/history/other_user_id',
    setupRequired: ['token'],
    expectStatus: 403,
    expectBody: { error: '无权访问' },
  },
  {
    id: 'history-004',
    group: '历史记录',
    name: 'Get History — 多轮对话后消息完整',
    description: '经过多轮对话后，历史记录应包含所有消息',
    method: 'GET',
    path: '/api/history/__USER_ID__',
    setupRequired: ['token', 'userId'],
    expectStatus: 200,
    expectFn: (body: any) =>
      Array.isArray(body.messages) &&
      body.messages.length >= 3 &&
      body.messages.some((m: any) => m.role === 'human' && m.content.includes('杭州')),
  },

  /* ═══════════════════════════════════
     7. 重置对话
     ═══════════════════════════════════ */
  {
    id: 'reset-001',
    group: '重置',
    name: 'Reset — 正常重置',
    description: '重置对话返回 ok: true',
    method: 'POST',
    path: '/api/reset/__USER_ID__',
    setupRequired: ['token', 'userId'],
    body: {},
    expectStatus: 200,
    expectBody: { ok: true },
  },
  {
    id: 'reset-002',
    group: '重置',
    name: 'Reset — 无认证',
    description: '不带 token 返回 401',
    method: 'POST',
    path: '/api/reset/some_user',
    body: {},
    expectStatus: 401,
  },

  /* ═══════════════════════════════════
     8. 收藏
     ═══════════════════════════════════ */
  {
    id: 'fav-001',
    group: '收藏',
    name: 'Add Favorite — 正常添加',
    description: '添加行程收藏返回 id',
    method: 'POST',
    path: '/api/favorites',
    setupRequired: ['token', 'userId'],
    body: { userId: '__USER_ID__', itinerary: SAMPLE_ITINERARY },
    expectStatus: 200,
    expectFn: (body: any) =>
      typeof body.id === 'number',
  },
  {
    id: 'fav-002',
    group: '收藏',
    name: 'Add Favorite — 重复添加',
    description: '相同行程再次添加返回 existed: true',
    method: 'POST',
    path: '/api/favorites',
    setupRequired: ['token', 'userId'],
    body: { userId: '__USER_ID__', itinerary: SAMPLE_ITINERARY },
    expectStatus: 200,
    expectFn: (body: any) =>
      typeof body.id === 'number' && body.existed === true,
  },
  {
    id: 'fav-003',
    group: '收藏',
    name: 'Add Favorite — 缺少参数',
    description: '不传 itinerary 返回 400',
    method: 'POST',
    path: '/api/favorites',
    setupRequired: ['token'],
    body: { userId: '__USER_ID__' },
    expectStatus: 400,
    expectBody: { error: '参数缺失' },
  },
  {
    id: 'fav-004',
    group: '收藏',
    name: 'Add Favorite — 无认证',
    description: '不带 token 返回 401',
    method: 'POST',
    path: '/api/favorites',
    body: { userId: 'test', itinerary: SAMPLE_ITINERARY },
    expectStatus: 401,
  },
  {
    id: 'fav-005',
    group: '收藏',
    name: 'Get Favorites — 正常获取',
    description: '获取收藏列表，返回 favorites 数组',
    method: 'GET',
    path: '/api/favorites/__USER_ID__',
    setupRequired: ['token', 'userId'],
    expectStatus: 200,
    expectFn: (body: any) =>
      Array.isArray(body.favorites) &&
      body.favorites.length > 0 &&
      body.favorites[0].itinerary?.meta?.city === '杭州',
  },
  {
    id: 'fav-006',
    group: '收藏',
    name: 'Delete Favorite — 正常删除',
    description: '删除收藏返回 ok: true',
    method: 'DELETE',
    path: '/api/favorites/__FAV_ID__',
    setupRequired: ['token', 'userId', 'favId'],
    headers: { 'Content-Type': 'application/json' },
    body: { userId: '__USER_ID__' },
    expectStatus: 200,
    expectBody: { ok: true },
  },
  {
    id: 'fav-007',
    group: '收藏',
    name: 'Delete Favorite — 不存在',
    description: '删除不存在的收藏返回 404',
    method: 'DELETE',
    path: '/api/favorites/999999',
    setupRequired: ['token'],
    headers: { 'Content-Type': 'application/json' },
    body: { userId: '__USER_ID__' },
    expectStatus: 404,
    expectBody: { error: '收藏不存在' },
  },
  {
    id: 'fav-008',
    group: '收藏',
    name: 'Delete Favorite — 无认证',
    description: '不带 token 删除收藏返回 401',
    method: 'DELETE',
    path: '/api/favorites/1',
    headers: { 'Content-Type': 'application/json' },
    body: { userId: 'test' },
    expectStatus: 401,
  },
  {
    id: 'fav-009',
    group: '收藏',
    name: 'Get Favorites — 无认证',
    description: '不带 token 获取收藏返回 401',
    method: 'GET',
    path: '/api/favorites/some_user',
    expectStatus: 401,
  },

  /* ═══════════════════════════════════
     9. 边缘场景
     ═══════════════════════════════════ */
  {
    id: 'edge-001',
    group: '边缘场景',
    name: '404 — 不存在的 API 路由',
    description: '请求 /api/nonexistent 返回 404',
    method: 'GET',
    path: '/api/nonexistent',
    expectStatus: 404,
  },
  {
    id: 'edge-002',
    group: '边缘场景',
    name: 'Chat Stream — 超长消息',
    description: '发送 5000 字符的消息',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token', 'userId'],
    headers: { 'Content-Type': 'application/json' },
    body: { message: '你好'.repeat(2500), userId: '__USER_ID__' },
    expectStatus: 200,
    llmJudge: '检查 SSE 响应是否正常返回，不应返回 5xx 错误或崩溃。result 的 type 应为 "text" 或 "itinerary"。',
  },
  {
    id: 'edge-003',
    group: '边缘场景',
    name: 'Register — 特殊字符 account',
    description: '邮箱含特殊字符的注册',
    method: 'POST',
    path: '/api/auth/register',
    body: { account: `special+${Date.now()}@test.com`, password: TEST_PASSWORD, name: 'Special+Char' },
    expectStatus: 200,
    expectFn: (body: any) => typeof body.token === 'string',
  },
  {
    id: 'edge-004',
    group: '边缘场景',
    name: 'Reset — 越权',
    description: 'A 用户无法重置 B 用户的对话',
    method: 'POST',
    path: '/api/reset/other_user_id',
    setupRequired: ['token'],
    body: {},
    expectStatus: 403,
    expectBody: { error: '无权操作' },
  },
  {
    id: 'edge-005',
    group: '边缘场景',
    name: 'Chat Stream — 空对象',
    description: 'POST 空 JSON 对象',
    method: 'POST',
    path: '/api/chat/stream',
    setupRequired: ['token'],
    headers: { 'Content-Type': 'application/json' },
    body: {},
    expectStatus: 400,
  },
  {
    id: 'edge-006',
    group: '边缘场景',
    name: 'History — 不存在的 userId',
    description: '不存在的 userId 返回空的 messages 数组',
    method: 'GET',
    path: '/api/history/nonexistent_user_golden',
    setupRequired: ['token'],
    expectStatus: 403,
  },
]

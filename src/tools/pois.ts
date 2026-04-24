import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

type POI = {
  name: string
  category: 'attraction' | 'restaurant' | 'shopping'
  city: string
  desc: string
  cost?: string
  duration?: string
  tags: string[]
}

const POI_DB: POI[] = [
  // 杭州
  { city: '杭州', name: '西湖', category: 'attraction', desc: '世界遗产，环湖约10公里，可骑行或漫步', duration: '3-4小时', tags: ['必去', '自然'] },
  { city: '杭州', name: '灵隐寺', category: 'attraction', desc: '千年古刹，飞来峰石刻', duration: '2-3小时', tags: ['人文', '佛教'] },
  { city: '杭州', name: '断桥残雪', category: 'attraction', desc: '西湖十景之一，白堤起点', duration: '1小时', tags: ['打卡', '免费'] },
  { city: '杭州', name: '雷峰塔', category: 'attraction', desc: '西湖标志性建筑，登塔可俯瞰全景', duration: '1-2小时', tags: ['地标'] },
  { city: '杭州', name: '南宋御街', category: 'attraction', desc: '历史街区，适合逛吃', duration: '2小时', tags: ['步行街', '美食'] },
  { city: '杭州', name: '西溪湿地', category: 'attraction', desc: '城市湿地公园，自然生态', duration: '3-4小时', tags: ['自然', '游船'] },
  { city: '杭州', name: '河坊街', category: 'attraction', desc: '老杭州风貌商业街', duration: '1-2小时', tags: ['美食', '购物'] },
  { city: '杭州', name: '楼外楼', category: 'restaurant', desc: '百年老字号，西湖醋鱼、东坡肉', cost: '¥150/人', tags: ['杭帮菜', '老字号'] },
  { city: '杭州', name: '外婆家', category: 'restaurant', desc: '性价比杭帮菜', cost: '¥80/人', tags: ['杭帮菜', '人气'] },
  { city: '杭州', name: '绿茶餐厅', category: 'restaurant', desc: '杭风创意菜', cost: '¥90/人', tags: ['杭帮菜', '网红'] },
  { city: '杭州', name: '知味观', category: 'restaurant', desc: '杭州老牌小吃，猫耳朵、小笼包', cost: '¥60/人', tags: ['小吃', '老字号'] },
  { city: '杭州', name: '西湖银泰城', category: 'shopping', desc: '西湖边大型商场', tags: ['商场'] },
  // 成都
  { city: '成都', name: '大熊猫繁育研究基地', category: 'attraction', desc: '看国宝大熊猫，建议早上去', duration: '3-4小时', tags: ['必去', '动物'] },
  { city: '成都', name: '宽窄巷子', category: 'attraction', desc: '成都名片，青砖黛瓦的民俗街区', duration: '2小时', tags: ['步行街', '美食'] },
  { city: '成都', name: '锦里古街', category: 'attraction', desc: '三国主题商业街，夜景美', duration: '1-2小时', tags: ['美食', '夜景'] },
  { city: '成都', name: '武侯祠', category: 'attraction', desc: '三国文化圣地', duration: '2小时', tags: ['人文', '三国'] },
  { city: '成都', name: '杜甫草堂', category: 'attraction', desc: '诗圣故居，清幽园林', duration: '1.5小时', tags: ['人文', '古典'] },
  { city: '成都', name: '青城山', category: 'attraction', desc: '道教名山，前山看人文后山看自然', duration: '半天-1天', tags: ['自然', '道教'] },
  { city: '成都', name: '都江堰', category: 'attraction', desc: '两千多年水利工程', duration: '半天', tags: ['古迹', '工程'] },
  { city: '成都', name: '小龙坎老火锅', category: 'restaurant', desc: '地道成都火锅', cost: '¥120/人', tags: ['火锅', '人气'] },
  { city: '成都', name: '陈麻婆豆腐', category: 'restaurant', desc: '百年老店，麻婆豆腐必点', cost: '¥70/人', tags: ['川菜', '老字号'] },
  { city: '成都', name: '龙抄手', category: 'restaurant', desc: '成都名小吃', cost: '¥30/人', tags: ['小吃', '面食'] },
  { city: '成都', name: '成都远洋太古里', category: 'shopping', desc: '开放式街区购物中心', tags: ['商场', '时尚'] },
  // 北京
  { city: '北京', name: '故宫博物院', category: 'attraction', desc: '明清皇宫，世界最大木结构建筑群', duration: '4-6小时', tags: ['必去', '人文'] },
  { city: '北京', name: '天安门广场', category: 'attraction', desc: '世界最大城市广场', duration: '1小时', tags: ['地标', '免费'] },
  { city: '北京', name: '长城（八达岭）', category: 'attraction', desc: '世界奇迹，距市区80公里', duration: '半天-1天', tags: ['必去', '古迹'] },
  { city: '北京', name: '颐和园', category: 'attraction', desc: '皇家园林，昆明湖万寿山', duration: '3-4小时', tags: ['皇家', '园林'] },
  { city: '北京', name: '天坛', category: 'attraction', desc: '明清祭天建筑群，祈年殿标志', duration: '2小时', tags: ['人文', '地标'] },
  { city: '北京', name: '什刹海', category: 'attraction', desc: '老北京胡同区，酒吧街', duration: '2-3小时', tags: ['胡同', '夜景'] },
  { city: '北京', name: '全聚德', category: 'restaurant', desc: '北京烤鸭老字号', cost: '¥200/人', tags: ['烤鸭', '老字号'] },
  { city: '北京', name: '东来顺', category: 'restaurant', desc: '传统涮羊肉', cost: '¥150/人', tags: ['火锅', '老字号'] },
  { city: '北京', name: '海碗居', category: 'restaurant', desc: '地道北京炸酱面', cost: '¥40/人', tags: ['面食', '北京味'] },
  // 上海
  { city: '上海', name: '外滩', category: 'attraction', desc: '万国建筑博览群，对望陆家嘴', duration: '1-2小时', tags: ['地标', '夜景'] },
  { city: '上海', name: '迪士尼乐园', category: 'attraction', desc: '中国大陆唯一迪士尼', duration: '1天', tags: ['乐园', '亲子'] },
  { city: '上海', name: '豫园', category: 'attraction', desc: '明代江南园林', duration: '1-2小时', tags: ['古典', '园林'] },
  { city: '上海', name: '东方明珠', category: 'attraction', desc: '上海地标电视塔', duration: '1-2小时', tags: ['地标', '观景'] },
  { city: '上海', name: '南京路步行街', category: 'attraction', desc: '中华第一商业街', duration: '2小时', tags: ['购物', '步行街'] },
  { city: '上海', name: '武康路', category: 'attraction', desc: '历史文化名街，网红打卡', duration: '1-2小时', tags: ['文艺', '打卡'] },
  { city: '上海', name: '南翔馒头店', category: 'restaurant', desc: '豫园里的上海小笼包', cost: '¥60/人', tags: ['小吃', '上海味'] },
  { city: '上海', name: '老吉士', category: 'restaurant', desc: '本帮菜代表', cost: '¥150/人', tags: ['本帮菜', '人气'] },
  // 西安
  { city: '西安', name: '兵马俑', category: 'attraction', desc: '世界第八大奇迹', duration: '3-4小时', tags: ['必去', '古迹'] },
  { city: '西安', name: '大雁塔', category: 'attraction', desc: '玄奘藏经处，大唐文化地标', duration: '1-2小时', tags: ['人文', '佛教'] },
  { city: '西安', name: '西安城墙', category: 'attraction', desc: '中国保存最完整的古城墙，可骑行', duration: '2小时', tags: ['古迹', '骑行'] },
  { city: '西安', name: '回民街', category: 'attraction', desc: '美食小吃一条街', duration: '1-2小时', tags: ['美食', '夜市'] },
  { city: '西安', name: '钟鼓楼', category: 'attraction', desc: '西安城市中心标志', duration: '1小时', tags: ['地标'] },
  { city: '西安', name: '陕西历史博物馆', category: 'attraction', desc: '周秦汉唐文物精华', duration: '2-3小时', tags: ['人文', '博物馆'] },
  { city: '西安', name: '长安大排档', category: 'restaurant', desc: '陕西创意菜', cost: '¥100/人', tags: ['陕菜', '网红'] },
  { city: '西安', name: '老孙家羊肉泡馍', category: 'restaurant', desc: '百年老店，羊肉泡馍经典', cost: '¥50/人', tags: ['小吃', '老字号'] },
  // 厦门
  { city: '厦门', name: '鼓浪屿', category: 'attraction', desc: '海上花园，万国建筑', duration: '半天-1天', tags: ['必去', '文艺'] },
  { city: '厦门', name: '曾厝垵', category: 'attraction', desc: '渔村改造的文艺街区', duration: '2小时', tags: ['文艺', '美食'] },
  { city: '厦门', name: '厦门大学', category: 'attraction', desc: '中国最美大学之一', duration: '1-2小时', tags: ['校园', '免费'] },
  { city: '厦门', name: '环岛路', category: 'attraction', desc: '海滨公路，骑行佳选', duration: '2小时', tags: ['骑行', '海景'] },
  { city: '厦门', name: '南普陀寺', category: 'attraction', desc: '闽南佛教胜地', duration: '1-2小时', tags: ['佛教', '免费'] },
  { city: '厦门', name: '沙坡尾', category: 'attraction', desc: '老避风坞，文艺小店集中', duration: '1-2小时', tags: ['文艺', '打卡'] },
  { city: '厦门', name: '中山路步行街', category: 'shopping', desc: '厦门传统商业街', tags: ['购物', '骑楼'] },
  { city: '厦门', name: '堂宴·老厦门私房菜', category: 'restaurant', desc: '地道厦门菜', cost: '¥120/人', tags: ['闽菜', '私房菜'] },
  { city: '厦门', name: '黄则和花生汤', category: 'restaurant', desc: '厦门老字号甜汤', cost: '¥15/人', tags: ['小吃', '老字号'] },
  // 大理
  { city: '大理', name: '洱海', category: 'attraction', desc: '环洱海约120公里，骑行或自驾', duration: '1天', tags: ['自然', '骑行'] },
  { city: '大理', name: '大理古城', category: 'attraction', desc: '南诏国都城，文艺慢生活', duration: '半天', tags: ['古城', '文艺'] },
  { city: '大理', name: '苍山', category: 'attraction', desc: '十九峰十八溪，可乘索道', duration: '半天', tags: ['自然', '登山'] },
  { city: '大理', name: '崇圣寺三塔', category: 'attraction', desc: '大理标志性佛教建筑', duration: '1-2小时', tags: ['人文', '佛教'] },
  { city: '大理', name: '喜洲古镇', category: 'attraction', desc: '白族民居建筑群', duration: '2-3小时', tags: ['古镇', '白族'] },
  { city: '大理', name: '双廊古镇', category: 'attraction', desc: '洱海东岸，海景绝佳', duration: '2-3小时', tags: ['古镇', '海景'] },
  { city: '大理', name: '益恒饭店', category: 'restaurant', desc: '大理本地菜', cost: '¥60/人', tags: ['白族菜', '家常'] },
  // 三亚
  { city: '三亚', name: '亚龙湾', category: 'attraction', desc: '天下第一湾，水清沙细', duration: '半天', tags: ['海滩', '游泳'] },
  { city: '三亚', name: '天涯海角', category: 'attraction', desc: '三亚地标景区', duration: '2-3小时', tags: ['地标', '礁石'] },
  { city: '三亚', name: '南山文化旅游区', category: 'attraction', desc: '108米海上观音', duration: '半天', tags: ['佛教', '地标'] },
  { city: '三亚', name: '蜈支洲岛', category: 'attraction', desc: '潜水胜地，水上项目丰富', duration: '1天', tags: ['海岛', '潜水'] },
  { city: '三亚', name: '鹿回头', category: 'attraction', desc: '俯瞰三亚全景的观景台', duration: '1-2小时', tags: ['夜景', '山顶'] },
  { city: '三亚', name: '椰梦长廊', category: 'attraction', desc: '日落散步道', duration: '1小时', tags: ['日落', '免费'] },
  { city: '三亚', name: '第一市场海鲜', category: 'restaurant', desc: '自选海鲜加工', cost: '¥150/人', tags: ['海鲜', '夜市'] },
  // 南京
  { city: '南京', name: '夫子庙秦淮河', category: 'attraction', desc: '十里秦淮，夜景绝佳', duration: '2-3小时', tags: ['夜景', '美食'] },
  { city: '南京', name: '中山陵', category: 'attraction', desc: '孙中山先生陵寝', duration: '2小时', tags: ['人文', '免费'] },
  { city: '南京', name: '明孝陵', category: 'attraction', desc: '明太祖陵墓，世界遗产', duration: '2小时', tags: ['古迹', '世界遗产'] },
  { city: '南京', name: '南京博物院', category: 'attraction', desc: '中国三大博物院之一', duration: '3-4小时', tags: ['人文', '博物馆'] },
  { city: '南京', name: '总统府', category: 'attraction', desc: '近代史重要遗址', duration: '2小时', tags: ['人文', '近代史'] },
  { city: '南京', name: '鸡鸣寺', category: 'attraction', desc: '南京最古老梵刹，春樱绝美', duration: '1-2小时', tags: ['佛教', '樱花'] },
  { city: '南京', name: '南京大牌档', category: 'restaurant', desc: '南京风味集合', cost: '¥80/人', tags: ['南京菜', '小吃'] },
  { city: '南京', name: '鸭得堡鸭血粉丝', category: 'restaurant', desc: '地道鸭血粉丝汤', cost: '¥30/人', tags: ['小吃', '南京味'] },
  // 丽江
  { city: '丽江', name: '丽江古城', category: 'attraction', desc: '世界遗产，小桥流水纳西人家', duration: '半天-1天', tags: ['古城', '世界遗产'] },
  { city: '丽江', name: '玉龙雪山', category: 'attraction', desc: '纳西神山，海拔5596米', duration: '1天', tags: ['自然', '雪山'] },
  { city: '丽江', name: '束河古镇', category: 'attraction', desc: '比大研更安静的古镇', duration: '2-3小时', tags: ['古镇', '清静'] },
  { city: '丽江', name: '泸沽湖', category: 'attraction', desc: '高原明珠，摩梭文化', duration: '1-2天', tags: ['自然', '摩梭'] },
  { city: '丽江', name: '虎跳峡', category: 'attraction', desc: '世界最深峡谷之一', duration: '半天', tags: ['自然', '徒步'] },
  { city: '丽江', name: '腊排骨火锅', category: 'restaurant', desc: '丽江特色锅物', cost: '¥70/人', tags: ['火锅', '纳西'] },
]

export const poisTool = new DynamicStructuredTool({
  name: 'search_pois',
  description: '搜索某城市的景点、餐厅、购物等兴趣点。用 category=all 一次搜索全部类别，queries 可传多个关键词。',
  schema: z.object({
    city: z.string().describe('城市名称'),
    category: z.enum(['attraction', 'restaurant', 'shopping', 'all']).describe('兴趣点类别，用"all"一次获取全部'),
    queries: z.array(z.string()).nullable().optional().describe('多个搜索关键词，一次搜索多个兴趣点'),
  }),
  func: async ({ city, category, queries }) => {
    let results = POI_DB.filter((p) => p.city === city)
    if (results.length === 0) {
      return `暂未收录"${city}"的兴趣点数据。目前支持的城市：${[...new Set(POI_DB.map((p) => p.city))].join('、')}。`
    }

    if ((category ?? 'all') !== 'all') {
      results = results.filter((p) => p.category === category)
    }
    if (queries && queries.length > 0) {
      results = results.filter((p) =>
        queries!.some((q) => {
          const lower = q.toLowerCase()
          return p.name.includes(lower) || p.desc.includes(lower) || p.tags.some((t) => t.includes(lower))
        })
      )
    }

    if (results.length === 0) {
      return `在"${city}"未找到匹配"${queries?.join(', ') ?? category}"的兴趣点。`
    }

    const lines = [`${city} 兴趣点搜索结果：`]
    for (const p of results) {
      const parts = [`- ${p.name}`]
      if (p.category === 'attraction') parts.push('[景点]')
      else if (p.category === 'restaurant') parts.push('[餐饮]')
      else parts.push('[购物]')
      parts.push(p.desc)
      if (p.duration) parts.push(`| 建议 ${p.duration}`)
      if (p.cost) parts.push(`| ${p.cost}`)
      lines.push(parts.join(' '))
    }
    return lines.join('\n')
  },
})

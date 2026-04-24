import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

const ROUTES: Record<string, { transit?: string; driving?: string; walking?: string; distance?: string }> = {
  '西湖-灵隐寺': { transit: '公交7路/游2路，约40分钟', driving: '约6公里，15分钟', distance: '6km' },
  '西湖-宋城': { transit: '地铁1号线转公交，约50分钟', driving: '约12公里，25分钟', distance: '12km' },
  '西湖-西溪湿地': { transit: '公交193路，约50分钟', driving: '约9公里，20分钟', distance: '9km' },
  '西湖-河坊街': { transit: '公交25路/步行1.5公里', driving: '约3公里，10分钟', walking: '步行约20分钟', distance: '1.5km' },
  '西湖-龙井村': { transit: '公交27路，约35分钟', driving: '约7公里，15分钟', distance: '7km' },
  '宽窄巷子-锦里': { transit: '地铁4号线→3号线，约25分钟', driving: '约4公里，12分钟', walking: '步行约35分钟', distance: '2.5km' },
  '宽窄巷子-大熊猫基地': { transit: '地铁3号线→熊猫专线，约60分钟', driving: '约18公里，35分钟', distance: '18km' },
  '锦里-武侯祠': { transit: '步行即到', walking: '步行约5分钟', distance: '300m' },
  '锦里-杜甫草堂': { transit: '公交35路/82路，约20分钟', driving: '约3公里，8分钟', walking: '步行约30分钟', distance: '2km' },
  '天安门-故宫': { walking: '步行穿过天安门即到午门', distance: '1km' },
  '天安门-颐和园': { transit: '地铁4号线，约40分钟', driving: '约14公里，30分钟', distance: '14km' },
  '天安门-八达岭': { transit: '地铁13号线→S2线，约2小时', driving: '约75公里，1.5小时', distance: '75km' },
  '故宫-天坛': { transit: '地铁1号线→5号线，约30分钟', driving: '约6公里，15分钟', distance: '6km' },
  '外滩-豫园': { walking: '步行约15分钟', distance: '1km' },
  '外滩-南京路步行街': { walking: '步行约10分钟', distance: '800m' },
  '外滩-武康路': { transit: '地铁10号线→交通大学站，约25分钟', driving: '约5公里，15分钟', distance: '5km' },
  '外滩-迪士尼': { transit: '地铁2号线→16号线→11号线，约1.5小时', driving: '约30公里，45分钟', distance: '30km' },
  '钟楼-兵马俑': { transit: '地铁9号线→临潼专线，约1.5小时', driving: '约40公里，50分钟', distance: '40km' },
  '钟楼-大雁塔': { transit: '地铁4号线，约15分钟', driving: '约5公里，10分钟', walking: '步行约40分钟', distance: '4km' },
  '钟楼-西安城墙（南门）': { walking: '步行约10分钟', distance: '600m' },
  '大雁塔-大唐不夜城': { walking: '步行即到，贯穿南北', distance: '2km' },
  '鼓浪屿码头-厦门大学': { transit: '公交2路/29路，约25分钟', driving: '约5公里，12分钟', distance: '5km' },
  '厦门大学-南普陀寺': { walking: '紧邻，步行5分钟', distance: '300m' },
  '厦门大学-曾厝垵': { transit: '公交29路/47路，约15分钟', driving: '约3公里，8分钟', walking: '步行约30分钟', distance: '2.5km' },
  '大理古城-洱海才村': { walking: '步行约20分钟', driving: '约2公里，5分钟', distance: '2km' },
  '大理古城-崇圣寺三塔': { walking: '步行约25分钟', driving: '约2公里，5分钟', distance: '1.5km' },
  '大理古城-喜洲古镇': { transit: '中巴车约30分钟', driving: '约18公里，30分钟', distance: '18km' },
  '亚龙湾-天涯海角': { driving: '约30公里，40分钟', transit: '公交25路/30路，约1.5小时', distance: '30km' },
  '亚龙湾-鹿回头': { driving: '约20公里，30分钟', transit: '公交15路转26路，约1小时', distance: '20km' },
  '大东海-第一市场': { transit: '公交2路/8路，约20分钟', driving: '约5公里，10分钟', distance: '5km' },
  '夫子庙-中山陵': { driving: '约7公里，20分钟', transit: '地铁3号线→2号线，约40分钟', distance: '7km' },
  '夫子庙-总统府': { transit: '地铁3号线→2号线，约20分钟', driving: '约3公里，10分钟', walking: '步行约30分钟', distance: '2.5km' },
  '中山陵-明孝陵': { walking: '毗邻，步行15分钟', distance: '1km' },
  '丽江古城-玉龙雪山': { driving: '约30公里，40分钟', transit: '公交101路，约1小时', distance: '30km' },
  '丽江古城-束河古镇': { transit: '公交6路/11路，约20分钟', driving: '约6公里，12分钟', distance: '6km' },
}

export const routeTool = new DynamicStructuredTool({
  name: 'plan_route',
  description: '规划城市内两点之间的交通路线，返回建议交通方式、耗时和距离。一次可传入 routes 数组批量规划多条路线。',
  schema: z.object({
    city: z.string().describe('所在城市'),
    routes: z.array(z.object({
      origin: z.string().describe('起点'),
      destination: z.string().describe('终点'),
      mode: z.enum(['transit', 'driving', 'walking']).describe('交通方式'),
    })).describe('多条路线，一次性规划避免多次调用'),
  }),
  func: async ({ city, routes }) => {
    const results = routes.map(r => planOneRoute(r.origin, r.destination, city, r.mode ?? 'transit'))
    return results.join('\n\n')
  },
})

function planOneRoute(origin: string, destination: string, city: string, mode: string): string {
  const key = `${origin}-${destination}`
  const reverseKey = `${destination}-${origin}`
  const route = ROUTES[key] ?? ROUTES[reverseKey]

  if (route) {
    const lines = [`从 ${origin} 到 ${destination}：`]
    const modeInfo = route[mode as keyof typeof route]
    if (modeInfo) {
      lines.push(`  ${modeInfo}`)
    } else if (mode === 'walking' && !route.walking) {
      lines.push(`  建议 ${route.transit ?? route.driving ?? '公共交通'}（距离较远不建议步行）`)
    } else {
      lines.push(`  建议 ${route.transit ?? route.driving ?? '公共交通'}`)
    }
    if (route.distance) lines.push(`  距离约 ${route.distance}`)
    return lines.join('\n')
  }

  const modeStr =
    mode === 'walking'
      ? '该距离不适合步行，建议公共交通'
      : mode === 'driving'
        ? '驾车约15-30分钟'
        : '公共交通约30-60分钟'

  return `从 ${origin} 到 ${destination}（${city}）：建议${modeStr}。具体路线可在到达后使用地图 App 查询。`
}

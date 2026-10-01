import type { House } from '@/types'

const img = (seed: string) => `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(seed)}&image_size=square_hd`

const layouts = ['一室一厅', '两室一厅', '两室两厅', '三室一厅', '三室两厅', '四室两厅']
const orientations = ['朝南', '朝北', '朝东', '朝西', '南北通透']
const petPolicies = ['允许养宠物', '禁止养宠物', '小型宠物可协商']
const districts = ['朝阳区', '海淀区', '西城区', '东城区', '丰台区', '通州区', '昌平区', '大兴区']
const streets = ['望京', '国贸', '中关村', '三里屯', '五道口', '上地', '回龙观', '亦庄', '通州北苑', '天通苑']
const landlordNames = ['王先生', '李女士', '张先生', '陈女士', '刘先生', '赵女士', '孙先生', '周女士']

const houseTitles = [
  '精装修 拎包入住 近地铁',
  '阳光充足 温馨舒适 整租',
  '家电齐全 交通便利 优质房源',
  '新装修 首次出租 干净整洁',
  '小区环境好 物业管理规范',
  '高层电梯房 视野开阔 采光好',
  '南北通透 户型方正 主卧朝南',
  '配套成熟 周边商圈繁华',
  '学区房 教育资源优质',
  '近公园 绿化率高 宜居宜住',
  '独立卫浴 带阳台 性价比高',
  'loft复式 时尚简约 年轻人首选',
  '合租单间 限女生 室友nice',
  '整租两居 可短租 押一付一',
  '房东直租 无中介费 随时看房',
  '品质小区 安保严密 安心居住',
  '家具家电全新 品牌装修',
  '近商圈 生活便利 购物方便',
  '安静不吵 适合居家 读书工作',
  '独门独户 私密性好 空间大'
]

export function generateMockHouses(): House[] {
  const houses: House[] = []
  for (let i = 0; i < 20; i++) {
    const layout = layouts[i % layouts.length]
    const price = 2000 + (i * 350) % 8000 + Math.floor(Math.random() * 1000)
    const area = 30 + (i * 12) % 90 + Math.floor(Math.random() * 20)
    const district = districts[i % districts.length]
    const street = streets[i % streets.length]
    const now = Date.now()

    houses.push({
      id: i + 1,
      title: houseTitles[i],
      images: [
        img(`modern apartment living room interior warm lighting ${i + 1}`),
        img(`cozy bedroom interior design warm tones ${i + 2}`),
        img(`clean modern kitchen interior ${i + 3}`),
        img(`bathroom interior modern style ${i + 4}`),
        img(`apartment balcony view city ${i + 5}`)
      ],
      location: `${district} ${street}`,
      price,
      area,
      layout,
      orientation: orientations[i % orientations.length],
      isFirstRent: i % 3 === 0,
      petPolicy: petPolicies[i % petPolicies.length],
      description: `该房源位于${district}${street}，${layout}，建筑面积${area}平米，${orientations[i % orientations.length]}，采光良好。小区周边配套完善，超市、医院、学校一应俱全，交通便利，多条公交线路直达。房屋精装修，家具家电齐全，拎包即可入住。${i % 3 === 0 ? '首次出租，房屋状况极佳。' : ''}`,
      publishTime: now - i * 86400000 * 2 - Math.floor(Math.random() * 86400000),
      landlord: {
        name: landlordNames[i % landlordNames.length],
        avatar: img(`portrait friendly landlord avatar ${i + 10}`),
        phone: `138${String(10000000 + i * 12345).slice(0, 8)}`
      }
    })
  }
  return houses
}

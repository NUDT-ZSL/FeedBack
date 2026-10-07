import html2canvas from 'html2canvas'
import { GlazeStroke, TempPoint, TextureData, GlazeType } from './store'
import { generateTextureDescription } from './kilnSimulation'

export interface ScrollData {
  potImageData: string
  glazesUsed: { glaze: GlazeType; thickness: number; area: number }[]
  tempHistory: TempPoint[]
  textureData: TextureData
  targetTemp: number
}

export const generateScrollContent = (data: ScrollData): HTMLElement => {
  const scroll = document.createElement('div')
  scroll.id = 'kiln-scroll'
  scroll.style.cssText = `
    width: 300px;
    height: 800px;
    background: linear-gradient(to bottom, #f5f0e8 0%, #e8e0d0 100%);
    border: 3px solid #8b7355;
    border-radius: 8px;
    padding: 20px;
    font-family: 'Noto Serif SC', serif;
    color: #333333;
    overflow: hidden;
    position: relative;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `
  
  const title = document.createElement('h1')
  title.textContent = '窑宝录'
  title.style.cssText = `
    font-family: 'Ma Shan Zheng', cursive;
    font-size: 28px;
    text-align: center;
    color: #8b0000;
    margin: 0 0 15px 0;
    border-bottom: 2px solid #8b7355;
    padding-bottom: 10px;
  `
  scroll.appendChild(title)
  
  const potPreview = document.createElement('div')
  potPreview.style.cssText = `
    width: 200px;
    height: 200px;
    margin: 10px auto;
    background: #fff;
    border: 2px solid #8b7355;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  `
  
  const potImg = document.createElement('img')
  potImg.src = data.potImageData
  potImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain; animation: rotate 10s linear infinite;'
  potPreview.appendChild(potImg)
  scroll.appendChild(potPreview)
  
  const glazeSection = document.createElement('div')
  glazeSection.style.cssText = 'margin: 15px 0;'
  
  const glazeTitle = document.createElement('h3')
  glazeTitle.textContent = '釉料配方'
  glazeTitle.style.cssText = `
    font-size: 16px;
    color: #5c3a21;
    margin: 10px 0;
    font-weight: bold;
  `
  glazeSection.appendChild(glazeTitle)
  
  data.glazesUsed.forEach((item) => {
    const glazeRow = document.createElement('div')
    glazeRow.style.cssText = 'display: flex; align-items: center; margin: 5px 0; font-size: 13px;'
    
    const colorBox = document.createElement('div')
    colorBox.style.cssText = `
      width: 20px;
      height: 20px;
      background: ${item.glaze.color};
      border: 1px solid #333;
      border-radius: 3px;
      margin-right: 10px;
    `
    
    const glazeInfo = document.createElement('span')
    glazeInfo.textContent = `${item.glaze.name} - 厚度: ${item.thickness.toFixed(2)}单位`
    glazeInfo.style.cssText = 'flex: 1;'
    
    glazeRow.appendChild(colorBox)
    glazeRow.appendChild(glazeInfo)
    glazeSection.appendChild(glazeRow)
  })
  
  if (data.glazesUsed.length === 0) {
    const emptyText = document.createElement('div')
    emptyText.textContent = '未施釉'
    emptyText.style.cssText = 'font-size: 13px; color: #666;'
    glazeSection.appendChild(emptyText)
  }
  
  scroll.appendChild(glazeSection)
  
  const tempSection = document.createElement('div')
  tempSection.style.cssText = 'margin: 15px 0;'
  
  const tempTitle = document.createElement('h3')
  tempTitle.textContent = '烧成曲线'
  tempTitle.style.cssText = `
    font-size: 16px;
    color: #5c3a21;
    margin: 10px 0;
    font-weight: bold;
  `
  tempSection.appendChild(tempTitle)
  
  const chart = createTempChart(data.tempHistory, data.targetTemp)
  tempSection.appendChild(chart)
  scroll.appendChild(tempSection)
  
  const textureSection = document.createElement('div')
  textureSection.style.cssText = 'margin: 15px 0;'
  
  const textureTitle = document.createElement('h3')
  textureTitle.textContent = '窑变效果'
  textureTitle.style.cssText = `
    font-size: 16px;
    color: #5c3a21;
    margin: 10px 0;
    font-weight: bold;
  `
  textureSection.appendChild(textureTitle)
  
  const textureDesc = document.createElement('p')
  textureDesc.textContent = generateTextureDescription(data.textureData)
  textureDesc.style.cssText = 'font-size: 13px; line-height: 1.8; text-align: justify;'
  textureSection.appendChild(textureDesc)
  scroll.appendChild(textureSection)
  
  const date = document.createElement('div')
  const now = new Date()
  date.textContent = `烧制时间: ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  date.style.cssText = 'text-align: right; font-size: 12px; color: #666; margin-top: 20px;'
  scroll.appendChild(date)
  
  const seal = document.createElement('div')
  seal.textContent = '御窑'
  seal.style.cssText = `
    font-family: 'Ma Shan Zheng', cursive;
    width: 50px;
    height: 50px;
    background: #8b0000;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 18px;
    margin: 10px auto 0;
  `
  scroll.appendChild(seal)
  
  return scroll
}

const createTempChart = (history: TempPoint[], targetTemp: number): HTMLElement => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 100%; height: 150px; position: relative; background: #fff; border: 1px solid #ccc; border-radius: 4px;'
  
  if (history.length < 2) {
    const empty = document.createElement('div')
    empty.textContent = '温度数据不足'
    empty.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #999; font-size: 12px;'
    container.appendChild(empty)
    return container
  }
  
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('viewBox', '0 0 260 150')
  svg.style.cssText = 'position: absolute; top: 0; left: 0;'
  
  const maxTime = Math.max(...history.map(p => p.time), 10)
  const maxTemp = Math.max(...history.map(p => p.temp), targetTemp, 1400)
  const minTemp = Math.min(...history.map(p => p.temp), 0)
  
  const padding = { top: 20, right: 10, bottom: 25, left: 35 }
  const chartWidth = 260 - padding.left - padding.right
  const chartHeight = 150 - padding.top - padding.bottom
  
  const x = (time: number) => padding.left + (time / maxTime) * chartWidth
  const y = (temp: number) => padding.top + chartHeight - ((temp - minTemp) / (maxTemp - minTemp)) * chartHeight
  
  for (let i = 0; i <= 4; i++) {
    const temp = minTemp + (maxTemp - minTemp) * (i / 4)
    const yPos = y(temp)
    
    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    gridLine.setAttribute('x1', String(padding.left))
    gridLine.setAttribute('y1', String(yPos))
    gridLine.setAttribute('x2', String(260 - padding.right))
    gridLine.setAttribute('y2', String(yPos))
    gridLine.setAttribute('stroke', '#eee')
    gridLine.setAttribute('stroke-dasharray', '2,2')
    svg.appendChild(gridLine)
    
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', '5')
    label.setAttribute('y', String(yPos + 4))
    label.setAttribute('font-size', '10')
    label.setAttribute('fill', '#666')
    label.textContent = `${Math.round(temp)}°`
    svg.appendChild(label)
  }
  
  const points = history
    .map((p, i) => {
      if (i === 0 || i % Math.max(1, Math.floor(history.length / 50)) === 0 || i === history.length - 1) {
        return `${x(p.time)},${y(p.temp)}`
      }
      return null
    })
    .filter(Boolean)
    .join(' ')
  
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', points)
  polyline.setAttribute('fill', 'none')
  polyline.setAttribute('stroke', '#8b0000')
  polyline.setAttribute('stroke-width', '2')
  svg.appendChild(polyline)
  
  const highlightPoints: { temp: number; color: string }[] = [
    { temp: 800, color: '#ff6600' },
    { temp: 1000, color: '#ffaa00' },
    { temp: 1200, color: '#ff0000' },
  ]
  
  highlightPoints.forEach(({ temp, color }) => {
    const closestPoint = history.reduce((prev, curr) => 
      Math.abs(curr.temp - temp) < Math.abs(prev.temp - temp) ? curr : prev
    )
    
    if (Math.abs(closestPoint.temp - temp) < 50) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx', String(x(closestPoint.time)))
      circle.setAttribute('cy', String(y(closestPoint.temp)))
      circle.setAttribute('r', '4')
      circle.setAttribute('fill', color)
      svg.appendChild(circle)
    }
  })
  
  const xAxisLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  xAxisLabel.setAttribute('x', '130')
  xAxisLabel.setAttribute('y', '148')
  xAxisLabel.setAttribute('text-anchor', 'middle')
  xAxisLabel.setAttribute('font-size', '10')
  xAxisLabel.setAttribute('fill', '#666')
  xAxisLabel.textContent = '时间 (秒)'
  svg.appendChild(xAxisLabel)
  
  container.appendChild(svg)
  return container
}

export const saveScrollAsPng = async (scrollElement: HTMLElement, filename: string = '窑宝录.png'): Promise<void> => {
  try {
    const canvas = await html2canvas(scrollElement, {
      backgroundColor: '#f5f0e8',
      scale: 2,
      useCORS: true,
      logging: false,
    })
    
    const link = document.createElement('a')
    link.download = filename
    link.href = canvas.toDataURL('image/png')
    link.click()
  } catch (error) {
    console.error('Failed to save scroll as PNG:', error)
    throw error
  }
}

export const capturePotThumbnail = async (
  renderFn: () => Promise<string>
): Promise<string> => {
  return await renderFn()
}

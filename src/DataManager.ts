import type { CityData, MonthlyData } from './EventBus'

const CITY_NAMES = [
  'Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Chongqing', 'Wuhan', 'Xi\'an',
  'Tokyo', 'Osaka', 'Seoul', 'Busan', 'Singapore', 'Bangkok', 'Jakarta', 'Manila',
  'Mumbai', 'Delhi', 'Kolkata', 'Chennai', 'Karachi', 'Lahore', 'Dhaka', 'Kathmandu',
  'London', 'Paris', 'Berlin', 'Madrid', 'Rome', 'Amsterdam', 'Vienna', 'Zurich',
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego',
  'Sao Paulo', 'Rio de Janeiro', 'Buenos Aires', 'Santiago', 'Lima', 'Bogota', 'Mexico City', 'Toronto',
  'Sydney', 'Melbourne', 'Auckland', 'Nairobi', 'Cairo', 'Lagos', 'Johannesburg', 'Cape Town',
  'Moscow', 'St Petersburg', 'Istanbul', 'Dubai', 'Riyadh', 'Tehran', 'Baghdad', 'Tel Aviv',
  'Hong Kong', 'Taipei', 'Kuala Lumpur', 'Ho Chi Minh City', 'Hanoi', 'Yangon', 'Colombo', 'Male',
  'Warsaw', 'Prague', 'Budapest', 'Athens', 'Lisbon', 'Dublin', 'Oslo', 'Stockholm',
  'Copenhagen', 'Helsinki', 'Reykjavik', 'Edinburgh', 'Barcelona', 'Milan', 'Munich', 'Hamburg',
  'Detroit', 'Seattle', 'Boston', 'Washington DC', 'San Francisco', 'Dallas', 'Miami', 'Atlanta',
  'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Winnipeg', 'Edmonton', 'Halifax', 'Quebec City',
  'Perth', 'Brisbane', 'Adelaide', 'Gold Coast', 'Wellington', 'Christchurch', 'Port Moresby', 'Suva',
  'Lagos', 'Accra', 'Addis Ababa', 'Casablanca', 'Tunis', 'Algiers', 'Tripoli', 'Khartoum',
  'Kampala', 'Dar es Salaam', 'Maputo', 'Luanda', 'Kinshasa', 'Harare', 'Abidjan', 'Dakar',
  'Guayaquil', 'Caracas', 'Asuncion', 'La Paz', 'Montevideo', 'Quito', 'Panama City', 'San Jose',
  'Guatemala City', 'San Salvador', 'Havana', 'Santo Domingo', 'Port-au-Prince', 'Kingston', 'Managua', 'Tegucigalpa',
  'Hamburg', 'Frankfurt', 'Stuttgart', 'Dusseldorf', 'Leipzig', 'Dresden', 'Cologne', 'Bonn',
  'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux',
  'Naples', 'Turin', 'Palermo', 'Genoa', 'Florence', 'Venice', 'Verona', 'Bologna',
  'Valencia', 'Seville', 'Bilbao', 'Malaga', 'Granada', 'Zaragoza', 'Alicante', 'Cordoba',
  'Rotterdam', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg', 'Almere', 'Breda', 'Nijmegen',
  'Brussels', 'Antwerp', 'Ghent', 'Bruges', 'Liege', 'Namur', 'Charleroi', 'Mons',
  'Geneva', 'Lausanne', 'Basel', 'Bern', 'Lucerne', 'St Gallen', 'Lugano', 'Winterthur',
  'Sofia', 'Bucharest', 'Belgrade', 'Zagreb', 'Ljubljana', 'Sarajevo', 'Skopje', 'Tirana',
  'Riga', 'Tallinn', 'Vilnius', 'Minsk', 'Kyiv', 'Chisinau', 'Tbilisi', 'Baku',
  'Yerevan', 'Ashgabat', 'Dushanbe', 'Bishkek', 'Tashkent', 'Astana', 'Almaty', 'Bishkek',
  'Ulaanbaatar', 'Pyongyang', 'Vientiane', 'Phnom Penh', 'Bandar Seri Begawan', 'Dili', 'Thimphu', 'Maldives',
  'Muscat', 'Doha', 'Kuwait City', 'Manama', 'Abu Dhabi', 'Amman', 'Beirut', 'Damascus',
  'Sanaa', 'Aden', 'Mogadishu', 'Djibouti', 'Asmara', 'Juba', 'Bujumbura', 'Kigali'
]

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function generateMonthlyData(baseAqi: number, baseTemp: number, baseWind: number, seed: number): MonthlyData[] {
  const rand = seededRandom(seed)
  const data: MonthlyData[] = []
  for (let year = 2020; year <= 2024; year++) {
    for (let month = 1; month <= 12; month++) {
      const seasonFactor = Math.abs(month - 7) / 6
      const aqiVariation = rand() * 80 - 40
      const tempVariation = (rand() * 10 - 5) + (seasonFactor * 15 - 7.5)
      const pm25Variation = rand() * 30 - 15
      const pm10Variation = rand() * 50 - 25
      const windVariation = rand() * 3 - 1.5
      data.push({
        month: `${year}-${String(month).padStart(2, '0')}`,
        aqi: Math.max(10, Math.min(500, Math.round(baseAqi + aqiVariation + seasonFactor * 30))),
        pm25: Math.max(5, Math.round(baseAqi * 0.6 + pm25Variation)),
        pm10: Math.max(10, Math.round(baseAqi * 1.2 + pm10Variation)),
        temperature: Math.round((baseTemp + tempVariation) * 10) / 10,
        windSpeed: Math.max(0.5, Math.round((baseWind + windVariation) * 10) / 10),
      })
    }
  }
  return data
}

function generateCities(): CityData[] {
  const rand = seededRandom(42)
  const cities: CityData[] = []
  const count = 300

  for (let i = 0; i < count; i++) {
    const lat = (rand() * 140 - 70)
    const lng = (rand() * 360 - 180)
    const nameIndex = i % CITY_NAMES.length
    const name = CITY_NAMES[nameIndex] + (i >= CITY_NAMES.length ? ` ${Math.floor(i / CITY_NAMES.length) + 1}` : '')
    const baseAqi = rand() * 300 + 50
    const baseTemp = rand() * 40 - 5
    const baseWind = rand() * 8 + 1

    cities.push({
      id: `city_${i}`,
      name,
      lat,
      lng,
      monthlyData: generateMonthlyData(baseAqi, baseTemp, baseWind, i + 1),
    })
  }

  return cities
}

class DataManager {
  private static instance: DataManager | null = null
  private cities: CityData[]

  private constructor() {
    this.cities = generateCities()
  }

  static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager()
    }
    return DataManager.instance
  }

  getCities(): CityData[] {
    return this.cities
  }

  getCityById(id: string): CityData | undefined {
    return this.cities.find((c) => c.id === id)
  }

  getMonthlyData(monthIndex: number): { city: CityData; data: MonthlyData }[] {
    return this.cities.map((city) => ({
      city,
      data: city.monthlyData[monthIndex],
    }))
  }

  filterByAqiRange(min: number, max: number, monthIndex: number): CityData[] {
    return this.cities.filter((city) => {
      const aqi = city.monthlyData[monthIndex]?.aqi ?? 0
      return aqi >= min && aqi <= max
    })
  }

  getGlobalStats(monthIndex: number): { avgAqi: number; cleanest: CityData; dirtiest: CityData } {
    let totalAqi = 0
    let cleanest = this.cities[0]
    let dirtiest = this.cities[0]
    let minAqi = Infinity
    let maxAqi = -Infinity

    for (const city of this.cities) {
      const aqi = city.monthlyData[monthIndex]?.aqi ?? 0
      totalAqi += aqi
      if (aqi < minAqi) {
        minAqi = aqi
        cleanest = city
      }
      if (aqi > maxAqi) {
        maxAqi = aqi
        dirtiest = city
      }
    }

    return {
      avgAqi: Math.round(totalAqi / this.cities.length),
      cleanest,
      dirtiest,
    }
  }

  getCityTrend(cityId: string): MonthlyData[] {
    const city = this.getCityById(cityId)
    return city?.monthlyData ?? []
  }
}

export const dataManager = DataManager.getInstance()

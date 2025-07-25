import axios from 'axios'
import charli3Store from '@/stores/charli3Store'

const API_BASE_URL = process.env.VUE_APP_API_URL || 'https://dev.gerowallet.io'

// Based on actual Charli3 API specification
export interface Charli3Group {
  id: string
}

export interface Charli3GroupsResponse {
  s: 'ok'
  d: {
    groups: Charli3Group[]
  }
}

export interface Charli3SymbolInfo {
  symbol: string[]
  description: string[]
  currency: string[]
  'base-currency': string[]
  'exchange-listed': string[]
  'exchange-traded': string[]
  minmovement: number[]
  pricescale: number[]
  type: string[]
  ticker: string[]
  timezone: string[]
  'session-regular': string[]
  's': 'ok'
}

export interface Charli3HistoryData {
  s: 'ok'
  t: number[]  // timestamps
  o: number[]  // open
  h: number[]  // high
  l: number[]  // low
  c: number[]  // close
  v: number[]  // volume
  tvl?: number[]  // total value locked (optional)
}

export interface Charli3CurrentStats {
  current_price: number
  current_tvl: number
  hourly_price_change: number
  hourly_tvl_change: number
  hourly_volume: number
  daily_price_change: number
  daily_tvl_change: number
  daily_volume: number
}

export interface Charli3StreamEvent {
  block_time: number
  pool_id: string
  current_price: number
  previous_price: number
  current_tvl: number
  previous_tvl: number
  volume: number
}

class Charli3API {
  private baseURL = `${API_BASE_URL}/api/charli3`
  private lastCharli3Request = 0
  private charli3RequestInterval = 2000 // 2 seconds between requests

  async getGroups(): Promise<Charli3GroupsResponse> {
    const response = await axios.get(`${this.baseURL}/groups`)
    return response.data
  }

  async getSymbolInfo(group: string): Promise<Charli3SymbolInfo> {
    try {
      console.log('🌐 Charli3 symbol_info call:', `${this.baseURL}/symbol_info`, { group });
      const response = await axios.get(`${this.baseURL}/symbol_info`, {
        params: { group }
      })
      console.log('✅ Charli3 symbol_info response:', response.status, response.statusText);
      return response.data
    } catch (error) {
      console.error('❌ Charli3 symbol_info error:', error.message, error.response?.status, error.response?.statusText);
      console.error('📡 Error details:', error.response?.data);
      throw error;
    }
  }

  async getHistory(
    symbol: string,
    resolution: string,
    from: number,
    to: number,
    includeTvl: boolean = false
  ): Promise<Charli3HistoryData> {
    try {
      console.log('🌐 Charli3 API call:', `${this.baseURL}/history`, { symbol: symbol.substring(0, 20) + '...', resolution, from, to, includeTvl });
      const response = await axios.get(`${this.baseURL}/history`, {
        params: { symbol, resolution, from, to, includeTvl }
      })
      console.log('✅ Charli3 API response:', response.status, response.statusText);
      return response.data
    } catch (error) {
      console.error('❌ Charli3 API error:', error.message, error.response?.status, error.response?.statusText);
      console.error('📡 Error details:', error.response?.data);
      throw error;
    }
  }

  async getCurrentTokenPrice(policy?: string, pool?: string): Promise<Charli3CurrentStats> {
    if (!policy && !pool) {
      throw new Error('Either policy or pool parameter must be provided')
    }
    if (policy && pool) {
      throw new Error('Provide either policy or pool parameter, not both')
    }
    
    const params = policy ? { policy } : { pool }
    const response = await axios.get(`${this.baseURL}/tokens/current`, { params })
    return response.data
  }

  async getTokenLogo(token: string): Promise<string | null> {
    const cacheKey = `charli3_token_logo_${token}`
    
    // Check store cache first
    const cached = charli3Store.getCachedLogo(cacheKey)
    if (cached) {
      return cached
    }
    
    try {
      // Rate limiting protection
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastCharli3Request
      if (timeSinceLastRequest < this.charli3RequestInterval) {
        const waitTime = this.charli3RequestInterval - timeSinceLastRequest
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      
      // Update last request time before making the request
      this.lastCharli3Request = Date.now()
      
      const response = await axios.get(`${this.baseURL}/tokens/logo/${token}`, {
        timeout: 3000, // 3 second timeout for better performance
        responseType: 'blob', // Handle as blob to get proper image data
        headers: {
          'Accept': 'image/png, image/jpeg, image/gif, image/webp, */*'
        }
      })
      
      // Create object URL from blob
      const blob = response.data
      const objectUrl = URL.createObjectURL(blob)
      
      // Cache the object URL in the store
      charli3Store.cacheTokenLogo(cacheKey, objectUrl)
      
      return objectUrl
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.warn(`Token logo request timed out for ${token}`)
      } else if (error.response?.status === 404) {
        console.log(`No logo found for token ${token}`)
      } else if (error.response?.status === 429) {
        // If we get a 429 (rate limit), wait longer before next request
        this.charli3RequestInterval = Math.min(this.charli3RequestInterval * 1.5, 10000) // Max 10 seconds
        console.warn(`Rate limited for token ${token}, increasing interval to ${this.charli3RequestInterval}ms`)
      } else {
        console.warn(`Failed to fetch logo for ${token}:`, error.message)
      }
      return null
    }
  }

  async streamTokens(poolIds: string[]): Promise<any> {
    const response = await axios.post(`${this.baseURL}/tokens/stream`, poolIds)
    return response.data
  }

  async getAggregateTokens(): Promise<any[]> {
    try {
      const symbolInfo = await this.getSymbolInfo('Aggregate')
      return symbolInfo.symbol.map((symbol, index) => ({
        symbol: symbol,
        description: symbolInfo.description[index],
        currency: symbolInfo.currency[index],
        baseCurrency: symbolInfo['base-currency']?.[index],
        exchange: symbolInfo['exchange-listed'][index],
        ticker: symbolInfo.ticker?.[index],
        group: 'Aggregate',
        pricescale: symbolInfo.pricescale[index]
      }))
    } catch (error) {
      console.error('Failed to get aggregate tokens:', error)
      return []
    }
  }

  // Get top performers using real-time data
  async getTopPerformersRealTime(limit: number = 10): Promise<{
    topVolume: any[],
    topGainers: any[],
    topTvl: any[]
  }> {
    try {
      const aggregateTokens = await this.getAggregateTokens()
      const tokensWithRealTimeData = []
      
      // Get real-time data for each token
      for (const token of aggregateTokens.slice(0, 30)) { // Limit to avoid too many requests
        try {
          if (token.ticker) {
            const currentData = await this.getCurrentTokenPrice(undefined, token.ticker)
            tokensWithRealTimeData.push({
              ...token,
              currentPrice: currentData.current_price,
              currentTvl: currentData.current_tvl,
              dailyPriceChange: currentData.daily_price_change,
              dailyVolume: currentData.daily_volume
            })
          }
        } catch (error) {
          // Skip tokens with no current data
          continue
        }
      }
      
      // Sort and get top performers
      const topVolume = tokensWithRealTimeData
        .filter(token => token.dailyVolume > 0)
        .sort((a, b) => (b.dailyVolume || 0) - (a.dailyVolume || 0))
        .slice(0, limit)
      
      const topGainers = tokensWithRealTimeData
        .filter(token => token.dailyPriceChange > 0)
        .sort((a, b) => (b.dailyPriceChange || 0) - (a.dailyPriceChange || 0))
        .slice(0, limit)
      
      const topTvl = tokensWithRealTimeData
        .filter(token => token.currentTvl > 0)
        .sort((a, b) => (b.currentTvl || 0) - (a.currentTvl || 0))
        .slice(0, limit)
      
      return {
        topVolume,
        topGainers,
        topTvl
      }
    } catch (error) {
      console.error('Failed to get real-time top performers:', error)
      return {
        topVolume: [],
        topGainers: [],
        topTvl: []
      }
    }
  }
}

export default new Charli3API()
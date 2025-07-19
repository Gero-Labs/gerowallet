import axios from 'axios'

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
    
    // Clear old cached entries that might be broken (data URLs from old implementation)
    const cached = this.getCachedTokenLogo(cacheKey)
    
    if (cached && cached.startsWith('data:')) {
      // Remove old base64 data URLs from cache
      localStorage.removeItem(cacheKey)
    } else if (cached && cached.startsWith('blob:')) {
      // Check if blob URL is still valid by trying to fetch it
      try {
        const testResponse = await fetch(cached, { method: 'HEAD' })
        if (testResponse.ok) {
          return cached
        } else {
          // Blob URL is invalid, remove from cache
          localStorage.removeItem(cacheKey)
        }
      } catch (error) {
        // Blob URL is invalid, remove from cache
        localStorage.removeItem(cacheKey)
      }
    } else if (cached) {
      return cached
    }
    
    
    try {
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
      
      // Cache the object URL for 24 hours
      this.setCachedTokenLogo(cacheKey, objectUrl)
      
      return objectUrl
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.warn(`Token logo request timed out for ${token}`)
      } else if (error.response?.status === 404) {
        console.log(`No logo found for token ${token}`)
      } else {
        console.warn(`Failed to fetch logo for ${token}:`, error.message)
      }
      return null
    }
  }

  private getCachedTokenLogo(cacheKey: string): string | null {
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        const now = Date.now()
        const twentyFourHours = 24 * 60 * 60 * 1000
        
        if (now - timestamp < twentyFourHours) {
          return data
        } else {
          // Remove expired cache
          localStorage.removeItem(cacheKey)
        }
      }
    } catch (error) {
      console.warn('Failed to retrieve cached token logo:', error)
    }
    return null
  }

  private setCachedTokenLogo(cacheKey: string, data: string): void {
    try {
      const cacheData = {
        data,
        timestamp: Date.now()
      }
      localStorage.setItem(cacheKey, JSON.stringify(cacheData))
    } catch (error) {
      console.warn('Failed to cache token logo:', error)
    }
  }

  async streamTokens(poolIds: string[]): Promise<any> {
    const response = await axios.post(`${this.baseURL}/tokens/stream`, poolIds)
    return response.data
  }

  // Helper methods for Market page - these will need to be rebuilt using available endpoints
  async getAllAvailableTokens(): Promise<any[]> {
    try {
      const groupsResponse = await this.getGroups()
      const allTokens: any[] = []
      
      // Get tokens from all groups
      for (const group of groupsResponse.d.groups) {
        try {
          const symbolInfo = await this.getSymbolInfo(group.id)
          
          // Transform symbol info to a more usable format
          const tokens = symbolInfo.symbol.map((symbol, index) => ({
            symbol: symbol,
            description: symbolInfo.description[index],
            currency: symbolInfo.currency[index],
            baseCurrency: symbolInfo['base-currency']?.[index],
            exchange: symbolInfo['exchange-listed'][index],
            ticker: symbolInfo.ticker?.[index],
            group: group.id,
            pricescale: symbolInfo.pricescale[index]
          }))
          
          allTokens.push(...tokens)
        } catch (error) {
          console.warn(`Failed to get symbols for group ${group.id}:`, error)
        }
      }
      
      return allTokens
    } catch (error) {
      console.error('Failed to get all available tokens:', error)
      return []
    }
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

  async getTokenCurrentPrices(tokens: any[]): Promise<any[]> {
    const tokensWithPrices = []
    
    // Get current data for each token
    for (const token of tokens) {
      try {
        if (token.ticker) {
          const priceData = await this.getCurrentTokenPrice(undefined, token.ticker)
          tokensWithPrices.push({
            ...token,
            currentPrice: priceData.current_price,
            currentTvl: priceData.current_tvl,
            hourlyPriceChange: priceData.hourly_price_change,
            dailyPriceChange: priceData.daily_price_change,
            dailyVolume: priceData.daily_volume
          })
        }
      } catch (error) {
        tokensWithPrices.push(token)
      }
    }
    
    return tokensWithPrices
  }

  // More efficient method to get market data using historical data
  async getMarketDataFromHistory(tokens: any[], limit: number = 20): Promise<any[]> {
    const tokensWithMarketData = []
    const now = Math.floor(Date.now() / 1000)
    const oneDayAgo = now - 24 * 60 * 60
    
    // Process tokens in batches to avoid overwhelming the API
    for (let i = 0; i < Math.min(tokens.length, limit); i++) {
      const token = tokens[i]
      
      try {
        if (token.ticker) {
          // Get 24h history to calculate volume and price changes
          const historyData = await this.getHistory(
            token.ticker,
            '60min', // 1 hour resolution
            oneDayAgo,
            now
          )
          
          if (historyData.s === 'ok' && historyData.c.length > 0) {
            const prices = historyData.c
            const volumes = historyData.v
            const currentPrice = prices[prices.length - 1]
            const startPrice = prices[0]
            
            // Calculate 24h volume (sum of all volumes)
            const dailyVolume = volumes.reduce((sum, vol) => sum + vol, 0)
            
            // Calculate price change
            const dailyPriceChange = startPrice > 0 
              ? ((currentPrice - startPrice) / startPrice) * 100 
              : 0
            
            // Get current TVL if available
            let currentTvl = 0
            if (historyData.tvl && historyData.tvl.length > 0) {
              currentTvl = historyData.tvl[historyData.tvl.length - 1]
            }
            
            tokensWithMarketData.push({
              ...token,
              currentPrice,
              dailyVolume,
              dailyPriceChange,
              currentTvl,
              priceData: {
                prices,
                volumes,
                timestamps: historyData.t
              }
            })
          }
        }
      } catch (error) {
        console.warn(`Failed to get market data for ${token.symbol}:`, error)
        // Include token without market data
        tokensWithMarketData.push(token)
      }
    }
    
    return tokensWithMarketData
  }

  // Get top performers efficiently
  async getTopPerformers(limit: number = 10): Promise<{
    topVolume: any[],
    topGainers: any[],
    topTvl: any[]
  }> {
    try {
      // Get aggregate tokens (most liquid/important)
      const aggregateTokens = await this.getAggregateTokens()
      
      // Get market data for top tokens
      const tokensWithData = await this.getMarketDataFromHistory(aggregateTokens, 50)
      
      // Sort and get top performers
      const topVolume = tokensWithData
        .filter(token => token.dailyVolume > 0)
        .sort((a, b) => (b.dailyVolume || 0) - (a.dailyVolume || 0))
        .slice(0, limit)
      
      const topGainers = tokensWithData
        .filter(token => token.dailyPriceChange > 0)
        .sort((a, b) => (b.dailyPriceChange || 0) - (a.dailyPriceChange || 0))
        .slice(0, limit)
      
      const topTvl = tokensWithData
        .filter(token => token.currentTvl > 0)
        .sort((a, b) => (b.currentTvl || 0) - (a.currentTvl || 0))
        .slice(0, limit)
      
      return {
        topVolume,
        topGainers,
        topTvl
      }
    } catch (error) {
      console.error('Failed to get top performers:', error)
      return {
        topVolume: [],
        topGainers: [],
        topTvl: []
      }
    }
  }

  // Alternative: Use current price endpoint for real-time data
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
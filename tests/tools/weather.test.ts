import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Weather tool regression tests.
 *
 * Requires mocking global fetch since the tool calls Open-Meteo APIs.
 * Covers: successful forecast, city not found, dates out of range.
 */

// Will be set dynamically in each test
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
})

/** Factory for a successful geo response */
function mockGeoResponse(city: string, lat: number, lng: number) {
  return {
    results: [
      { name: city, latitude: lat, longitude: lng, country: '中国' },
    ],
  }
}

/** Factory for a successful weather response */
function mockWeatherResponse() {
  return {
    daily: {
      time: ['2025-04-01', '2025-04-02', '2025-04-03'],
      temperature_2m_max: [20, 22, 18],
      temperature_2m_min: [12, 14, 10],
      weather_code: [0, 61, 3],
      precipitation_probability_max: [5, 80, 20],
    },
  }
}

/** Dynamic import the tool so fetch mock is in place */
async function getWeatherToolFunc() {
  const mod = await import('../../src/tools/weather')
  return mod.weatherTool.func
}

describe('Weather tool: successful forecast', () => {
  it('should return forecast for requested dates', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeoResponse('杭州', 30.25, 120.17)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWeatherResponse()),
      })

    const func = await getWeatherToolFunc()
    const result = await func({ city: '杭州', dates: ['2025-04-01', '2025-04-02'] })

    expect(result).toContain('杭州')
    expect(result).toContain('2025-04-01')
    expect(result).toContain('2025-04-02')
    expect(result).toContain('°C')
    expect(result).toContain('降水概率')
  })

  it('should make geo and weather API calls', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeoResponse('北京', 39.90, 116.40)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWeatherResponse()),
      })

    const func = await getWeatherToolFunc()
    await func({ city: '北京', dates: ['2025-04-01'] })

    // First call should be geo API
    expect(fetchMock.mock.calls[0][0]).toContain('geocoding-api')
    // Second call should be weather API
    expect(fetchMock.mock.calls[1][0]).toContain('open-meteo.com/v1/forecast')
  })
})

describe('Weather tool: city not found', () => {
  it('should return error when geo lookup returns empty', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: null }),
    })

    const func = await getWeatherToolFunc()
    const result = await func({ city: '不存在', dates: ['2025-04-01'] })

    expect(result).toContain('未找到')
    expect(result).toContain('不存在')
  })

  it('should return error when geo API fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const func = await getWeatherToolFunc()
    await expect(func({ city: '杭州', dates: ['2025-04-01'] })).rejects.toThrow()
  })
})

describe('Weather tool: dates not in range', () => {
  it('should return fallback when dates not in forecast period', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGeoResponse('杭州', 30.25, 120.17)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWeatherResponse()),
      })

    const func = await getWeatherToolFunc()
    const result = await func({ city: '杭州', dates: ['2099-01-01'] })

    expect(result).toContain('均不在预报范围内')
    expect(result).toContain('未来几天概况')
  })
})

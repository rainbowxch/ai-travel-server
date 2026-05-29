/**
 * Enrich itinerary sight blocks with images from Wikipedia (free, no API key needed).
 * If no image is found for a block, it's silently skipped.
 */
import type { Itinerary } from './types.js'

/** Extract a searchable place name from a block title like "漫步白堤·断桥残雪" → "断桥残雪" */
function extractSearchTerm(title: string): string {
  let t = title.trim()
  // Remove leading verbs/actions
  t = t.replace(/^(前往|漫步|逛|参观|游览|乘船|观看|返回|到达|走进|体验|途经|经过|沿|爬上|去|登上|登)/, '')
  // Remove trailing generic suffixes
  t = t.replace(/(（可选）|\(可选\)|徒步|拍照|外观|散步|登高|漫步|游览|参观|体验|观光|登顶)$/, '')
  // Split on common separators, take the longest segment (most likely the place name)
  const parts = t.split(/[·•\-—、，,→/\\]/).map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return title
  return parts.reduce((a, b) => a.length >= b.length ? a : b)
}

async function fetchWikipediaThumb(title: string, retries = 2): Promise<string | null> {
  try {
    const url = `https://zh.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(title)}&format=json&pithumbsize=500&origin=*`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    // Rate limited (429 or HTML response) — wait with backoff and retry
    if (resp.status === 429 || (!resp.ok && resp.headers.get('content-type')?.includes('text/html'))) {
      if (retries > 0) {
        const waitMs = (3 - retries) * 3000
        await new Promise(r => setTimeout(r, waitMs))
        return fetchWikipediaThumb(title, retries - 1)
      }
      return null
    }
    const data = await resp.json() as any
    const pages = data?.query?.pages ?? {}
    for (const id of Object.keys(pages)) {
      if (id === '-1') continue
      const thumb = pages[id].thumbnail?.source
      if (thumb) return thumb
    }
    return null
  } catch {
    return null
  }
}

export async function enrichItineraryImages(itinerary: Itinerary): Promise<void> {
  // Gather sight blocks that could have images
  const sightBlocks: { block: { pics?: string[] }; term: string }[] = []
  for (const day of itinerary.days) {
    for (const block of day.blocks) {
      if (block.type === 'sight') {
        const term = extractSearchTerm(block.title)
        if (term) sightBlocks.push({ block, term })
      }
    }
  }
  if (sightBlocks.length === 0) return

  // Fetch images sequentially with a delay between requests to avoid rate limiting
  for (const { block, term } of sightBlocks) {
    const url = await fetchWikipediaThumb(term)
    if (url) {
      block.pics = [url]
    }
    // 1200ms delay between requests to avoid hitting Wikipedia rate limits
    await new Promise(r => setTimeout(r, 1200))
  }

  // Fallback: use picsum placeholder for any sight block still without an image
  for (const { block, term } of sightBlocks) {
    if (!block.pics?.length) {
      block.pics = [`https://picsum.photos/seed/${encodeURIComponent(term)}/400/300`]
    }
  }
}

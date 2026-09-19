// Mappls business discovery provider.
// All Mappls REST calls are made by the Firebase Cloud Function so OAuth
// credentials never reach the browser and legacy Mappls CORS/auth constraints
// do not block the CallPilot web client.

import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export type BusinessPlace = {
  name: string
  address: string
  eLoc: string
  /** Alias of eLoc, kept so existing UI code that treats this as an opaque id keeps working. */
  placeId: string
  category?: string
  phone?: string
  phoneOther?: string[]
  website?: string
  source: 'mappls'
}

export type ResolvedLocation = {
  eLoc: string
  label: string
}

type MapplsSuggestedLocation = {
  type?: string
  eLoc?: string
  placeName?: string
  alternateName?: string
  placeAddress?: string
  keywords?: string[]
  landlineNo?: string
  mobileNo?: string
  distance?: number
}

type MapplsSearchResponse = {
  suggestedLocations?: MapplsSuggestedLocation[]
}

type MapplsPlaceDetailsResponse = {
  name?: string
  address?: string
  telephone?: string
  mobile?: string
  website?: string
  email?: string
}

type MapplsApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'network'
  | 'malformed'
  | 'unavailable'

class MapplsApiError extends Error {
  readonly kind: MapplsApiErrorKind

  constructor(kind: MapplsApiErrorKind) {
    super(kind)
    this.kind = kind
  }
}

type MapplsAction =
  | 'resolveLocation'
  | 'nearbySearch'
  | 'textSearch'
  | 'placeDetails'

async function mapplsCall<T>(
  action: MapplsAction,
  payload: { query?: string; eLoc?: string } = {},
): Promise<T | null> {
  const callable = httpsCallable<{ action: MapplsAction; query?: string; eLoc?: string }, T>(
    functions,
    'mapplsProxy',
  )

  try {
    const result = await callable({ action, ...payload })
    return result.data ?? null
  } catch (error) {
    const code = error instanceof Error ? error.message : ''

    if (code.includes('unauthenticated') || code.includes('permission-denied')) {
      throw new MapplsApiError('unauthorized')
    }
    if (code.includes('resource-exhausted')) {
      throw new MapplsApiError('rate_limited')
    }
    if (code.includes('unavailable')) {
      throw new MapplsApiError('network')
    }
    if (code.includes('invalid-argument')) {
      throw new MapplsApiError('malformed')
    }
    if (code.includes('failed-precondition')) {
      throw new MapplsApiError('unavailable')
    }

    throw new MapplsApiError('unavailable')
  }
}

// ---------------------------------------------------------------------------
// Query-intent -> keyword expansion (mirrors the previous Geoapify heuristics,
// since Mappls's own category-code taxonomy is not reliably present on every
// account tier). This is what keeps "AC service" from being drowned out by
// unrelated POIs, per the relevance-quality requirement.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'need',
  'service',
  'services',
  'please',
  'call',
  'ask',
  'about',
  'business',
  'recipient',
  'a',
  'an',
  'in',
  'at',
  'to',
  'my',
])

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
}

function buildKeywordSet(query: string): string[] {
  const q = query.toLowerCase()

  if (
    q.includes('ac ') ||
    q.includes(' ac') ||
    q.includes('a/c') ||
    q.includes('air conditioner') ||
    q.includes('air conditioning') ||
    q.includes('air-condition') ||
    q.includes('aircon') ||
    q.includes('hvac') ||
    q.includes('cooling') ||
    q.includes('refrigeration')
  ) {
    return [
      'ac',
      'a/c',
      'air conditioner',
      'air conditioning',
      'air-condition',
      'aircon',
      'hvac',
      'cooling',
      'refrigeration',
      'climate control',
      'split ac',
      'window ac',
      'central ac',
      'chiller',
    ]
  }

  if (q.includes('electrician')) return ['electrician', 'electrical']
  if (q.includes('plumb')) return ['plumber', 'plumbing']
  if (q.includes('carpen')) return ['carpenter', 'carpentry']
  if (q.includes('clean')) return ['cleaning', 'cleaner', 'laundry']

  if (
    q.includes('restaurant') ||
    q.includes('cafe') ||
    q.includes('food') ||
    q.includes('table') ||
    q.includes('hotel')
  ) {
    return ['restaurant', 'cafe', 'food', 'dining', 'kitchen', 'hotel']
  }

  if (
    q.includes('doctor') ||
    q.includes('hospital') ||
    q.includes('clinic') ||
    q.includes('dentist') ||
    q.includes('medical')
  ) {
    return ['doctor', 'hospital', 'clinic', 'dentist', 'medical', 'health']
  }

  return extractKeywords(q)
}

// Categories/keywords that should never surface for a generic business search
// unless the user explicitly asked for them.
const BLOCKED_TEXT = [
  'bank',
  'atm',
  'petrol pump',
  'petrol station',
  'fuel station',
  'police station',
  'post office',
  'government office',
  'collectorate',
  'municipal office',
  'district court',
  'fire station',
  'ambulance station',
  'crematorium',
  'funeral',
  'mortuary',
  'embassy',
  'consulate',
  'political party',
  'charging station',
  'car wash',
]

function isBlocked(text: string): boolean {
  return BLOCKED_TEXT.some((phrase) => text.includes(phrase))
}

function toBusinessPlace(item: MapplsSuggestedLocation): BusinessPlace | null {
  if (!item.eLoc || !item.placeName) return null

  const phones = [item.mobileNo, item.landlineNo].filter(
    (value): value is string => Boolean(value && value.trim()),
  )

  return {
    name: item.placeName,
    address: item.placeAddress ?? '',
    eLoc: item.eLoc,
    placeId: item.eLoc,
    category: item.keywords?.[0],
    phone: phones[0],
    phoneOther: phones.slice(1),
    source: 'mappls',
  }
}

function scoreAndFilter(
  items: MapplsSuggestedLocation[],
  keywords: string[],
): BusinessPlace[] {
  return items
    .map((item) => ({ item, place: toBusinessPlace(item) }))
    .filter(
      (entry): entry is { item: MapplsSuggestedLocation; place: BusinessPlace } =>
        entry.place !== null,
    )
    .filter(({ item, place }) => {
      const text = `${place.name} ${item.alternateName ?? ''} ${place.address}`.toLowerCase()
      return !isBlocked(text)
    })
    .map(({ item, place }) => {
      const text = `${place.name} ${item.alternateName ?? ''} ${place.address}`.toLowerCase()
      let score = 0

      for (const keyword of keywords) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
        if (pattern.test(text)) score += 10
      }

      // Places with an already-known phone number rank slightly higher, since
      // that's what CallPilot ultimately needs.
      if (place.phone) score += 1

      return { place, score }
    })
    .filter(({ score }) => (keywords.length ? score > 0 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ place }) => place)
}

/**
 * Resolves a free-text area/city name (e.g. "Tiruppur") to a Mappls eLoc that
 * can be used as a location anchor for the Nearby API. Mappls's Nearby API
 * accepts an eLoc directly as `refLocation`, so there is no need to round-trip
 * through raw latitude/longitude the way the previous Geoapify integration did.
 */
export async function resolveLocation(
  location: string,
): Promise<ResolvedLocation | null> {
  const trimmed = location.trim()
  if (!trimmed) return null

  const data = await mapplsCall<MapplsSearchResponse>('resolveLocation', {
    query: trimmed,
  })
  const match = data?.suggestedLocations?.find((item) => item.eLoc)

  if (!match?.eLoc) return null

  return {
    eLoc: match.eLoc,
    label: match.placeName ?? match.placeAddress ?? trimmed,
  }
}

async function nearbySearch(
  keywordQuery: string,
  eLoc: string,
): Promise<MapplsSuggestedLocation[]> {
  const data = await mapplsCall<MapplsSearchResponse>('nearbySearch', {
    query: keywordQuery,
    eLoc,
  })
  return data?.suggestedLocations ?? []
}

async function textSearch(query: string): Promise<MapplsSuggestedLocation[]> {
  const data = await mapplsCall<MapplsSearchResponse>('textSearch', { query })
  return data?.suggestedLocations ?? []
}

/**
 * Finds candidate businesses for a natural-language service/business query.
 * Uses Nearby search when a location anchor is available (this also returns
 * public contact numbers directly when Mappls has them), and falls back to
 * Text Search - unbiased by location - otherwise or when Nearby comes back empty.
 */
export async function findBusinesses(
  query: string,
  location?: ResolvedLocation,
): Promise<BusinessPlace[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const keywords = buildKeywordSet(trimmedQuery)
  const nearbyKeywordQuery = keywords.length ? keywords.slice(0, 8).join(';') : trimmedQuery

  let rawResults: MapplsSuggestedLocation[] = []

  if (location?.eLoc) {
    rawResults = await nearbySearch(nearbyKeywordQuery, location.eLoc)
  }

  let results = scoreAndFilter(rawResults, keywords)

  if (!results.length) {
    const textResults = await textSearch(trimmedQuery)
    results = scoreAndFilter(textResults, keywords)
  }

  return results
}

export async function findBusiness(
  query: string,
  location?: ResolvedLocation,
): Promise<BusinessPlace | null> {
  const businesses = await findBusinesses(query, location)
  return businesses[0] ?? null
}

/**
 * Fetches/confirms the verified public contact for a discovered business.
 * If the search step already surfaced a phone number (Nearby does this
 * directly), that is treated as the verified contact without an extra call.
 * Otherwise falls back to the Place Details API. Contact fields are a
 * premium Mappls subtemplate, so a missing phone here is expected and
 * handled by the caller as "no public phone number found".
 */
export async function getBusinessDetails(
  place: BusinessPlace,
): Promise<Pick<BusinessPlace, 'phone' | 'phoneOther' | 'website'>> {
  if (place.phone || place.phoneOther?.length) {
    return { phone: place.phone, phoneOther: place.phoneOther, website: place.website }
  }

  const data = await mapplsCall<MapplsPlaceDetailsResponse>('placeDetails', {
    eLoc: place.eLoc,
  })

  if (!data) {
    return { phone: undefined, phoneOther: undefined, website: undefined }
  }

  const phones = [data.mobile, data.telephone].filter(
    (value): value is string => Boolean(value && value.trim()),
  )

  return {
    phone: phones[0],
    phoneOther: phones.slice(1),
    website: data.website,
  }
}

export { MapplsApiError }

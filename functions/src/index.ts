import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

const MAPPLS_CLIENT_ID = defineSecret('MAPPLS_CLIENT_ID')
const MAPPLS_CLIENT_SECRET = defineSecret('MAPPLS_CLIENT_SECRET')

const TOKEN_URL = 'https://outpost.mappls.com/api/security/oauth/token'
const ATLAS_BASE = 'https://atlas.mappls.com/api/places'
const PLACE_DETAILS_BASE = 'https://place.mappls.com/O2O/entity/place-details'

let cachedToken: { value: string; expiresAt: number } | null = null
let tokenPromise: Promise<string> | null = null

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

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  if (tokenPromise) return tokenPromise

  tokenPromise = (async () => {
    const clientId = MAPPLS_CLIENT_ID.value()
    const clientSecret = MAPPLS_CLIENT_SECRET.value()

    if (!clientId || !clientSecret) {
      throw new HttpsError(
        'failed-precondition',
        'Mappls OAuth credentials are not configured on the server.',
      )
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    })

    let response: Response
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    } catch {
      throw new HttpsError('unavailable', 'Could not reach Mappls authentication service.')
    }

    if (!response.ok) {
      throw new HttpsError('permission-denied', 'Mappls authentication was rejected.')
    }

    const data = (await response.json()) as {
      access_token?: string
      token_type?: string
      expires_in?: number
    }

    if (!data.access_token) {
      throw new HttpsError('internal', 'Mappls did not return an access token.')
    }

    const expiresInSeconds = Number(data.expires_in) || 3600
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, expiresInSeconds - 60) * 1000,
    }

    return data.access_token
  })()

  try {
    return await tokenPromise
  } finally {
    tokenPromise = null
  }
}

async function mapplsGet(url: URL): Promise<unknown> {
  const accessToken = await getAccessToken()

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new HttpsError('unavailable', 'Could not reach Mappls business search.')
  }

  if (response.status === 204) return null

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null
      throw new HttpsError('permission-denied', 'Mappls rejected the access token.')
    }
    if (response.status === 403) {
      throw new HttpsError('resource-exhausted', 'Mappls access is restricted or rate-limited.')
    }
    if (response.status === 429) {
      throw new HttpsError('resource-exhausted', 'Mappls rate limit was reached.')
    }
    if (response.status >= 500) {
      throw new HttpsError('unavailable', 'Mappls is temporarily unavailable.')
    }
    throw new HttpsError('invalid-argument', 'Mappls rejected the business search request.')
  }

  try {
    return await response.json()
  } catch {
    throw new HttpsError('internal', 'Mappls returned an invalid response.')
  }
}

export const mapplsProxy = onCall(
  {
    region: 'asia-south1',
    secrets: [MAPPLS_CLIENT_ID, MAPPLS_CLIENT_SECRET],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in is required for business discovery.')
    }

    const data = request.data as {
      action?: string
      query?: string
      location?: string
      eLoc?: string
    }

    const action = data?.action

    if (action === 'resolveLocation') {
      const query = String(data.query ?? '').trim()
      if (!query) throw new HttpsError('invalid-argument', 'Location query is required.')

      const url = new URL(`${ATLAS_BASE}/textsearch/json`)
      url.searchParams.set('query', query)
      url.searchParams.set('region', 'IND')
      return (await mapplsGet(url)) as MapplsSearchResponse | null
    }

    if (action === 'textSearch') {
      const query = String(data.query ?? '').trim()
      if (!query) throw new HttpsError('invalid-argument', 'Search query is required.')

      const url = new URL(`${ATLAS_BASE}/textsearch/json`)
      url.searchParams.set('query', query)
      url.searchParams.set('region', 'IND')
      return (await mapplsGet(url)) as MapplsSearchResponse | null
    }

    if (action === 'nearbySearch') {
      const keywords = String(data.query ?? '').trim()
      const eLoc = String(data.eLoc ?? '').trim()
      if (!keywords || !eLoc) {
        throw new HttpsError('invalid-argument', 'Nearby search requires keywords and a location.')
      }

      const url = new URL(`${ATLAS_BASE}/nearby/json`)
      url.searchParams.set('keywords', keywords)
      url.searchParams.set('refLocation', eLoc)
      url.searchParams.set('radius', '10000')
      url.searchParams.set('region', 'IND')
      url.searchParams.set('sortBy', 'dist:asc')
      return (await mapplsGet(url)) as MapplsSearchResponse | null
    }

    if (action === 'placeDetails') {
      const eLoc = String(data.eLoc ?? '').trim()
      if (!eLoc) throw new HttpsError('invalid-argument', 'Place eLoc is required.')

      const url = new URL(`${PLACE_DETAILS_BASE}/${encodeURIComponent(eLoc)}`)
      return (await mapplsGet(url)) as MapplsPlaceDetailsResponse | null
    }

    throw new HttpsError('invalid-argument', 'Unknown Mappls operation.')
  },
)

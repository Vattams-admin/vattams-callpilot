export type BusinessPlace = {
  name: string
  address: string
  latitude: number
  longitude: number
  placeId: string
  category?: string
  phone?: string
  phoneOther?: string[]
  website?: string
}

type GeoapifyResponse = {
  results?: Array<{
    name?: string
    formatted?: string
    lat?: number
    lon?: number
    place_id?: string
    category?: string
  }>
}

type PlaceDetailsResponse = {
  features?: Array<{
    properties?: {
      feature_type?: string
      name?: string
      formatted?: string
      website?: string
      contact?: {
        phone?: string
        phone_other?: string[]
      }
    }
  }>
}

function getApiKey() {
  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY

  if (!apiKey) {
    throw new Error('Geoapify API key is not configured.')
  }

  return apiKey
}

export async function resolveLocation(
  location: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const url = new URL('https://api.geoapify.com/v1/geocode/search')

  url.searchParams.set('text', `${location}, India`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')
  url.searchParams.set('filter', 'countrycode:in')
  url.searchParams.set('apiKey', getApiKey())

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Geoapify location lookup failed: ${response.status}`)
  }

  const data = (await response.json()) as GeoapifyResponse
  const result = data.results?.find(
    (item) =>
      typeof item.lat === 'number' &&
      typeof item.lon === 'number',
  )

  if (!result || typeof result.lat !== 'number' || typeof result.lon !== 'number') {
    return null
  }

  return {
    latitude: result.lat,
    longitude: result.lon,
  }
}

export async function findBusinesses(
  query: string,
  location?: { latitude: number; longitude: number },
): Promise<BusinessPlace[]> {
  const q = query.toLowerCase()

  let categories = 'commercial,service'
  let keywords: string[] = []

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
    categories =
      'service,commercial.elektronics,commercial.houseware_and_hardware.hardware_and_tools,commercial.houseware_and_hardware.doityourself'

    keywords = [
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
      'ductable',
      'chiller',
    ]
  } else if (q.includes('electrician')) {
    categories =
      'service.electrician,commercial.houseware_and_hardware.hardware_and_tools'
    keywords = ['electrician', 'electrical']
  } else if (q.includes('plumber') || q.includes('plumbing')) {
    categories =
      'service,commercial.houseware_and_hardware.hardware_and_tools'
    keywords = ['plumber', 'plumbing']
  } else if (q.includes('carpenter')) {
    categories = 'service.carpenter'
    keywords = ['carpenter', 'carpentry']
  } else if (q.includes('cleaning') || q.includes('cleaner')) {
    categories = 'service.cleaning'
    keywords = ['cleaning', 'cleaner', 'laundry']
  } else if (
    q.includes('restaurant') ||
    q.includes('cafe') ||
    q.includes('food') ||
    q.includes('table')
  ) {
    categories = 'catering.restaurant,catering.cafe,catering.fast_food'
  } else if (
    q.includes('doctor') ||
    q.includes('hospital') ||
    q.includes('clinic') ||
    q.includes('dentist') ||
    q.includes('medical')
  ) {
    categories = 'healthcare'
  } else {
    keywords = q
      .split(/[^a-z0-9]+/)
      .filter(
        (word) =>
          word.length > 2 &&
          ![
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
          ].includes(word),
      )
  }

  const search = async (radius: number) => {
    const url = new URL('https://api.geoapify.com/v2/places')

    url.searchParams.set('categories', categories)
    url.searchParams.set('limit', '50')
    url.searchParams.set('lang', 'en')

    if (location) {
      url.searchParams.set(
        'filter',
        `circle:${location.longitude},${location.latitude},${radius}`,
      )
      url.searchParams.set(
        'bias',
        `proximity:${location.longitude},${location.latitude}`,
      )
    } else {
      url.searchParams.set('filter', 'countrycode:in')
    }

    url.searchParams.set('apiKey', getApiKey())

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Geoapify Places request failed: ${response.status}`)
    }

    const data = (await response.json()) as {
      features?: Array<{
        properties?: {
          name?: string
          formatted?: string
          lat?: number
          lon?: number
          place_id?: string
          categories?: string[]
        }
      }>
    }

    return (data.features ?? [])
      .map((feature) => feature.properties)
      .filter(
        (place): place is NonNullable<typeof place> =>
          Boolean(
            place?.name &&
              typeof place.lat === 'number' &&
              typeof place.lon === 'number' &&
              place.place_id,
          ),
      )
  }

  const blocked = [
    'service.financial',
    'service.police',
    'service.post',
    'service.social_facility',
    'service.crematorium',
    'service.mortuary',
    'service.place_of_mourning',
    'service.fire_station',
    'service.ambulance_station',
    'service.funeral',
    'service.vehicle.fuel',
    'service.vehicle.charging_station',
    'service.vehicle.repair',
    'service.vehicle.car_wash',
    'office.government',
    'office.diplomatic',
    'office.political_party',
  ]

  const scorePlaces = (places: Awaited<ReturnType<typeof search>>) =>
    places
      .filter((place) => {
        const cats: string[] = place.categories ?? []

        if (!cats.length) return false

        if (
          cats.some((cat) =>
            blocked.some(
              (prefix) =>
                cat === prefix || cat.startsWith(`${prefix}.`),
            ),
          )
        ) {
          return false
        }

        return true
      })
      .map((place) => {
        const text =
          `${place.name ?? ''} ${place.formatted ?? ''}`.toLowerCase()

        let score = 0

        for (const keyword of keywords) {
          const escaped = keyword.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
          const pattern = new RegExp(
            `(?<![a-z0-9])${escaped}(?![a-z0-9])`,
            'i',
          )

          if (pattern.test(text)) score += 10
        }

        return { place, score }
      })
      .filter(({ score }) => keywords.length ? score > 0 : true)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ place }) => ({
        name: place.name!,
        address: place.formatted ?? '',
        latitude: place.lat!,
        longitude: place.lon!,
        placeId: place.place_id!,
        category: place.categories?.[0],
      }))

  let results = scorePlaces(await search(15000))

  if (!results.length && location) {
    results = scorePlaces(await search(30000))
  }

  return results
}

export async function findBusiness(
  query: string,
  location?: { latitude: number; longitude: number },
): Promise<BusinessPlace | null> {
  const businesses = await findBusinesses(query, location)
  return businesses[0] ?? null
}

export async function getBusinessDetails(
  placeId: string,
): Promise<Pick<BusinessPlace, 'phone' | 'phoneOther' | 'website'>> {
  const url = new URL('https://api.geoapify.com/v2/place-details')

  url.searchParams.set('id', placeId)
  url.searchParams.set('apiKey', getApiKey())

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Geoapify Place Details failed: ${response.status}`)
  }

  const data = (await response.json()) as PlaceDetailsResponse

  const details = data.features?.find(
    (feature) => feature.properties?.feature_type === 'details',
  )?.properties

  return {
    phone: details?.contact?.phone,
    phoneOther: details?.contact?.phone_other,
    website: details?.website,
  }
}

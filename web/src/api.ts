export type Weekends = 'separate' | 'count'

export type CapacityCell = {
  allocated: number
  weekend: number
  capacity: number
}

export type CapacityPerson = {
  id: number
  name: string
  weeklyHours: number
  cells: CapacityCell[]
}

export type CapacityResponse = {
  from: string
  to: string
  weeks: string[]
  weekends: Weekends
  total: number
  limit: number
  offset: number
  people: CapacityPerson[]
}

export type CapacityParams = {
  from: string
  to: string
  weekends: Weekends
  overOnly: boolean
  limit: number
  offset: number
}

export type Person = {
  id: number
  name: string
  weeklyHours: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const UNREACHABLE = "Can't reach the server"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(UNREACHABLE, 0)
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new ApiError(UNREACHABLE, res.status)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status)
  }
  return res.json()
}

export function fetchCapacity(params: CapacityParams, signal?: AbortSignal) {
  const search = new URLSearchParams({
    from: params.from,
    to: params.to,
    weekends: params.weekends,
    over: String(params.overOnly),
    limit: String(params.limit),
    offset: String(params.offset),
  })
  return request<CapacityResponse>(`/api/capacity?${search}`, { signal })
}

export function updateWeeklyHours(id: number, weeklyHours: number) {
  return request<Person>(`/api/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeklyHours }),
  })
}

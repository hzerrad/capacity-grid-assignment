import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { fetchCapacity, updateWeeklyHours, type CapacityParams, type CapacityResponse } from './api'

const capacityKey = ['capacity'] as const

export function useCapacity(params: CapacityParams) {
  return useQuery({
    queryKey: [...capacityKey, params],
    queryFn: ({ signal }) => fetchCapacity(params, signal),
    placeholderData: keepPreviousData,
  })
}

type UpdateVariables = { weeklyHours: number; previous: number }

export const weeklyHoursKey = (id: number) => ['weeklyHours', id] as const

function setWeeklyHours(client: QueryClient, id: number, weeklyHours: number) {
  client.setQueriesData<CapacityResponse>({ queryKey: capacityKey }, (data) =>
    data && { ...data, people: data.people.map((p) => (p.id === id ? { ...p, weeklyHours } : p)) },
  )
}

// Capacity is derived on the server: refetch only this person's row, or the whole over-allocated view.
async function refreshPerson(client: QueryClient, id: number) {
  const views = client.getQueriesData<CapacityResponse>({ queryKey: capacityKey })
  await Promise.all(
    views.map(async ([key, data]) => {
      const params = key[1] as CapacityParams | undefined
      if (!data || !params || !data.people.some((p) => p.id === id)) return
      if (params.overOnly) return client.invalidateQueries({ queryKey: key, exact: true })
      const row = await fetchCapacity({ ...params, overOnly: false, offset: 0, person: id })
      const fresh = row.people[0]
      client.setQueryData<CapacityResponse>(key, (current) =>
        current && fresh && { ...current, people: current.people.map((p) => (p.id === id ? fresh : p)) },
      )
    }),
  )
}

export function useUpdateWeeklyHours(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: weeklyHoursKey(id),
    mutationFn: ({ weeklyHours }: UpdateVariables) => updateWeeklyHours(id, weeklyHours),
    onMutate: async ({ weeklyHours }) => {
      await client.cancelQueries({ queryKey: capacityKey })
      setWeeklyHours(client, id, weeklyHours)
    },
    onError: (_err, { previous }) => setWeeklyHours(client, id, previous),
    onSuccess: () => refreshPerson(client, id),
  })
}

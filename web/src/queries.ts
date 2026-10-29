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

type UpdateVariables = { id: number; weeklyHours: number; previous: number }

// Mirrors the server rule (capacity = weekly hours for a whole week) until the
// refetch in onSettled replaces it with the real numbers.
function applyWeeklyHours(client: QueryClient, id: number, weeklyHours: number) {
  client.setQueriesData<CapacityResponse>({ queryKey: capacityKey }, (data) =>
    data && {
      ...data,
      people: data.people.map((p) =>
        p.id === id
          ? { ...p, weeklyHours, cells: p.cells.map((c) => ({ ...c, capacity: weeklyHours })) }
          : p,
      ),
    },
  )
}

export function useUpdateWeeklyHours() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, weeklyHours }: UpdateVariables) => updateWeeklyHours(id, weeklyHours),
    onMutate: async ({ id, weeklyHours }) => {
      await client.cancelQueries({ queryKey: capacityKey })
      applyWeeklyHours(client, id, weeklyHours)
    },
    onError: (_err, { id, previous }) => applyWeeklyHours(client, id, previous),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: capacityKey })
    },
  })
}

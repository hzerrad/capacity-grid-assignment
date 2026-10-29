package main

import (
	"net/http"
	"reflect"
	"testing"
	"time"
)

func TestStartOfWeek(t *testing.T) {
	cases := map[string]string{
		"2025-12-29": "2025-12-29", // Monday
		"2026-01-01": "2025-12-29", // Thursday, across the year boundary
		"2026-01-04": "2025-12-29", // Sunday belongs to the preceding Monday
	}
	for in, want := range cases {
		d, _ := time.Parse(dateLayout, in)
		if got := startOfWeek(d).Format(dateLayout); got != want {
			t.Errorf("startOfWeek(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestCapacityRejectsBadParams(t *testing.T) {
	s := &server{} // validation runs before any query
	for _, query := range []string{
		"",
		"from=2026-01-01",
		"from=x&to=2026-01-02",
		"from=2026-01-10&to=2026-01-01",
		"from=2026-01-01&to=2026-12-31",
		"from=2026-01-01&to=2026-01-02&weekends=all",
		"from=2026-01-01&to=2026-01-02&over=maybe",
		"from=2026-01-01&to=2026-01-02&limit=0",
		"from=2026-01-01&to=2026-01-02&limit=201",
		"from=2026-01-01&to=2026-01-02&offset=-1",
	} {
		t.Run(query, func(t *testing.T) {
			assertError(t, do(t, s, http.MethodGet, "/api/capacity?"+query, ""), http.StatusBadRequest)
		})
	}
}

func cellsOf(p capacityPerson) (allocated, weekend, capacity []float64) {
	for _, c := range p.Cells {
		allocated = append(allocated, c.Allocated)
		weekend = append(weekend, c.Weekend)
		capacity = append(capacity, c.Capacity)
	}
	return
}

func TestCapacityCuratedPeople(t *testing.T) {
	s := dbServer(t)
	resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-31&to=2026-01-16&limit=5", ""), http.StatusOK)

	if resp.From != "2025-12-29" || resp.To != "2026-01-18" {
		t.Errorf("range = %s..%s, want snapped to 2025-12-29..2026-01-18", resp.From, resp.To)
	}
	if want := []string{"2025-12-29", "2026-01-05", "2026-01-12"}; !reflect.DeepEqual(resp.Weeks, want) {
		t.Errorf("weeks = %v, want %v", resp.Weeks, want)
	}
	if resp.Total != 500 {
		t.Errorf("total = %d, want every person including those with no assignments", resp.Total)
	}

	// Hand-computed: fragment rows summed, weekday hours only, weekend hours reported apart.
	want := map[string][3][]float64{
		"Ana Ferreira": {{40, 0, 30}, {16, 0, 0}, {40, 40, 40}},
		"Bo Lindqvist": {{0, 32, 8}, {0, 16, 0}, {40, 40, 40}},
		"Cem Aydin":    {{0, 4, 12}, {0, 0, 0}, {20, 20, 20}},
		"Dee Okafor":   {{0, 45, 40}, {0, 0, 0}, {40, 40, 40}},
		"Eli Nakamura": {{0, 20, 0}, {0, 0, 0}, {0, 0, 0}},
	}
	if len(resp.People) != len(want) {
		t.Fatalf("got %d people, want %d", len(resp.People), len(want))
	}
	for _, p := range resp.People {
		w, ok := want[p.Name]
		if !ok {
			t.Errorf("unexpected person %q", p.Name)
			continue
		}
		allocated, weekend, capacity := cellsOf(p)
		if !reflect.DeepEqual([3][]float64{allocated, weekend, capacity}, w) {
			t.Errorf("%s: allocated %v weekend %v capacity %v, want %v", p.Name, allocated, weekend, capacity, w)
		}
	}
}

func TestCapacityCountsWeekendsWhenAsked(t *testing.T) {
	s := dbServer(t)
	resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&limit=2&weekends=count", ""), http.StatusOK)

	allocated, weekend, _ := cellsOf(resp.People[0])
	if resp.People[0].Name != "Ana Ferreira" || allocated[0] != 56 || weekend[0] != 16 {
		t.Errorf("Ana week 1 = %v allocated, %v weekend; want 56 including 16", allocated[0], weekend[0])
	}
}

func TestCapacityOverOnly(t *testing.T) {
	s := dbServer(t)
	resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&over=true&limit=200", ""), http.StatusOK)

	if resp.Total != 41 || len(resp.People) != 41 {
		t.Errorf("total = %d, people = %d; want 41", resp.Total, len(resp.People))
	}
	for _, p := range resp.People {
		over := false
		for _, c := range p.Cells {
			over = over || c.Allocated > c.Capacity
		}
		if !over {
			t.Errorf("%s is not over-allocated in any week", p.Name)
		}
	}
}

func TestCapacityPagination(t *testing.T) {
	s := dbServer(t)
	first := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&limit=3", ""), http.StatusOK)
	second := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&limit=3&offset=3", ""), http.StatusOK)
	if len(first.People) != 3 || len(second.People) != 3 || first.People[2].ID == second.People[0].ID {
		t.Errorf("pages overlap or are short: %v / %v", first.People, second.People)
	}

	past := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&offset=9999", ""), http.StatusOK)
	if past.Total != 500 || len(past.People) != 0 {
		t.Errorf("past the end: total = %d, people = %d; want 500 and none", past.Total, len(past.People))
	}
}

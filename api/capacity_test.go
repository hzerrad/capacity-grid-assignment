package main

import (
	"context"
	"net/http"
	"reflect"
	"strconv"
	"strings"
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

func TestCapacityPagePastTheEnd(t *testing.T) {
	s := dbServer(t)
	past := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&offset=9999", ""), http.StatusOK)
	if past.Total != 500 || len(past.People) != 0 {
		t.Errorf("past the end: total = %d, people = %d; want 500 and none", past.Total, len(past.People))
	}
}

func TestCapacityClipsToRange(t *testing.T) {
	s := dbServer(t)
	byName := func(query string) map[string]capacityPerson {
		resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?"+query+"&limit=5", ""), http.StatusOK)
		m := map[string]capacityPerson{}
		for _, p := range resp.People {
			m[p.Name] = p
		}
		return m
	}

	// Bo's booking runs Fri 9 Jan → Mon 12 Jan at 8h/day.
	starts := byName("from=2026-01-12&to=2026-01-18")
	if a, w, _ := cellsOf(starts["Bo Lindqvist"]); a[0] != 8 || w[0] != 0 {
		t.Errorf("range starting 12 Jan: Bo = %v allocated, %v weekend; want only Monday's 8", a, w)
	}
	if a, _, _ := cellsOf(starts["Ana Ferreira"]); a[0] != 30 {
		t.Errorf("range starting 12 Jan: Ana = %v; her 29 Dec booking must not leak in", a)
	}

	ends := byName("from=2026-01-05&to=2026-01-11")
	if a, w, _ := cellsOf(ends["Bo Lindqvist"]); a[0] != 32 || w[0] != 16 {
		t.Errorf("range ending 11 Jan: Bo = %v allocated, %v weekend; want 32 and 16 (Monday 12th excluded)", a, w)
	}
}

func TestCapacityRangeLimits(t *testing.T) {
	s := dbServer(t)
	full := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-07-05&limit=1", ""), http.StatusOK)
	if len(full.Weeks) != maxWeeks || len(full.People[0].Cells) != maxWeeks {
		t.Errorf("26-week range: %d weeks, %d cells", len(full.Weeks), len(full.People[0].Cells))
	}
	assertError(t, do(t, s, http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-07-06", ""), http.StatusBadRequest)

	day := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2026-01-07&to=2026-01-07&limit=1", ""), http.StatusOK)
	if !reflect.DeepEqual(day.Weeks, []string{"2026-01-05"}) || day.To != "2026-01-11" {
		t.Errorf("single day: weeks %v to %s, want the one week 2026-01-05..2026-01-11", day.Weeks, day.To)
	}
}

func TestCapacityEveryPersonOnceAcrossPages(t *testing.T) {
	s := dbServer(t)
	var idle struct {
		id    int32
		hours float64
	}
	err := s.db.QueryRow(context.Background(), `
		SELECT id, weekly_hours::float8 FROM people p
		WHERE NOT EXISTS (
		  SELECT 1 FROM assignments a
		  WHERE a.person_id = p.id AND a.start_date <= '2026-01-18' AND a.end_date >= '2025-12-29')
		ORDER BY id LIMIT 1`).Scan(&idle.id, &idle.hours)
	if err != nil {
		t.Fatal(err)
	}

	seen := map[int32]capacityPerson{}
	for offset := 0; offset < 500; offset += maxLimit {
		resp := decode[capacityResponse](t, do(t, s, http.MethodGet,
			"/api/capacity?from=2025-12-29&to=2026-01-18&limit=200&offset="+strconv.Itoa(offset), ""), http.StatusOK)
		for _, p := range resp.People {
			if _, dup := seen[p.ID]; dup {
				t.Fatalf("person %d appears on more than one page", p.ID)
			}
			seen[p.ID] = p
		}
	}
	if len(seen) != 500 {
		t.Fatalf("saw %d people across pages, want 500", len(seen))
	}

	for _, c := range seen[idle.id].Cells {
		if c.Allocated != 0 || c.Weekend != 0 || c.Capacity != idle.hours {
			t.Errorf("person %d has no bookings but got cell %+v, want 0 against %v", idle.id, c, idle.hours)
		}
	}
}

func TestCapacityOverOnlyFollowsWeekendRule(t *testing.T) {
	s := dbServer(t)
	resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-18&over=true&weekends=count&limit=200", ""), http.StatusOK)
	if resp.Total != 146 {
		t.Errorf("over-allocated with weekends counted = %d, want 146", resp.Total)
	}
}

func TestCapacityDatabaseDown(t *testing.T) {
	s := unreachableServer(t)
	rec := do(t, s, http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-01-11", "")
	assertError(t, rec, http.StatusInternalServerError)
	if body := rec.Body.String(); strings.Contains(body, "127.0.0.1") || strings.Contains(body, "dial") {
		t.Errorf("error leaks connection details: %s", body)
	}
}

func TestCapacitySinglePerson(t *testing.T) {
	s := dbServer(t)
	resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-01-11&person=4", ""), http.StatusOK)
	if resp.Total != 1 || len(resp.People) != 1 || resp.People[0].Name != "Dee Okafor" || resp.People[0].Cells[0].Allocated != 45 {
		t.Errorf("person=4: total %d, people %+v", resp.Total, resp.People)
	}
	assertError(t, do(t, &server{}, http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-01-11&person=abc", ""), http.StatusBadRequest)
}

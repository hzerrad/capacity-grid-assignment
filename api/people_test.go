package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestUpdatePersonRejectsBadInput(t *testing.T) {
	s := &server{} // validation runs before any query
	cases := map[string]struct{ path, body string }{
		"non-numeric id":  {"/api/people/abc", `{"weeklyHours":40}`},
		"id beyond int32": {"/api/people/99999999999", `{"weeklyHours":40}`},
		"zero id":         {"/api/people/0", `{"weeklyHours":40}`},
		"empty body":      {"/api/people/1", ``},
		"not JSON":        {"/api/people/1", `nope`},
		"string number":   {"/api/people/1", `{"weeklyHours":"40"}`},
		"null":            {"/api/people/1", `{"weeklyHours":null}`},
		"missing field":   {"/api/people/1", `{}`},
		"unknown field":   {"/api/people/1", `{"weeklyHours":40,"name":"x"}`},
		"trailing data":   {"/api/people/1", `{"weeklyHours":40}{}`},
		"negative":        {"/api/people/1", `{"weeklyHours":-1}`},
		"over a week":     {"/api/people/1", `{"weeklyHours":169}`},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assertError(t, do(t, s, http.MethodPatch, c.path, c.body), http.StatusBadRequest)
		})
	}
}

func TestUpdatePersonRejectsOversizedBody(t *testing.T) {
	s := &server{}
	body := strings.Repeat(" ", 2048) + `{"weeklyHours":40}`
	assertError(t, do(t, s, http.MethodPatch, "/api/people/1", body), http.StatusBadRequest)
}

func TestUpdatePersonDatabaseDown(t *testing.T) {
	assertError(t, do(t, unreachableServer(t), http.MethodPatch, "/api/people/1", `{"weeklyHours":40}`), http.StatusInternalServerError)
}

func TestUpdatePersonAcceptsBounds(t *testing.T) {
	s := dbServer(t)
	restoreDee(t, s)
	for _, hours := range []float64{0, maxWeeklyHours} {
		p := decode[person](t, do(t, s, http.MethodPatch, "/api/people/4", fmt.Sprintf(`{"weeklyHours":%v}`, hours)), http.StatusOK)
		if p.WeeklyHours != hours {
			t.Errorf("saved %v, got %v", hours, p.WeeklyHours)
		}
	}
}

func TestUpdatePersonNotFound(t *testing.T) {
	s := dbServer(t)
	assertError(t, do(t, s, http.MethodPatch, "/api/people/999999", `{"weeklyHours":40}`), http.StatusNotFound)
}

func TestUpdatePersonFlowsIntoCapacity(t *testing.T) {
	s := dbServer(t)
	restoreDee(t, s)

	p := decode[person](t, do(t, s, http.MethodPatch, "/api/people/4", `{"weeklyHours":37.5}`), http.StatusOK)
	if p.ID != 4 || p.Name != "Dee Okafor" || p.WeeklyHours != 37.5 {
		t.Fatalf("response = %+v", p)
	}

	resp := decode[capacityResponse](t, do(t, s, http.MethodGet, "/api/capacity?from=2026-01-12&to=2026-01-18&over=true&limit=200", ""), http.StatusOK)
	for _, q := range resp.People {
		if q.ID == 4 {
			if q.WeeklyHours != 37.5 || q.Cells[0].Capacity != 37.5 || q.Cells[0].Allocated != 40 {
				t.Errorf("Dee after edit = %+v, want 40 allocated against 37.5", q)
			}
			return
		}
	}
	t.Error("Dee should be over-allocated (40 / 37.5) in the week of 2026-01-12 after the edit")
}

func restoreDee(t *testing.T, s *server) {
	t.Helper()
	var original float64
	if err := s.db.QueryRow(context.Background(), `SELECT weekly_hours::float8 FROM people WHERE id = 4`).Scan(&original); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.db.Exec(context.Background(), `UPDATE people SET weekly_hours = $1 WHERE id = 4`, original)
	})
}

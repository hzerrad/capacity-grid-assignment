package main

import (
	"log"
	"net/http"
	"strconv"
	"time"
)

const (
	dateLayout   = "2006-01-02"
	maxWeeks     = 26
	defaultLimit = 50
	maxLimit     = 200
)

type capacityCell struct {
	Allocated float64 `json:"allocated"`
	Weekend   float64 `json:"weekend"`
	Capacity  float64 `json:"capacity"`
}

type capacityPerson struct {
	ID          int32          `json:"id"`
	Name        string         `json:"name"`
	WeeklyHours float64        `json:"weeklyHours"`
	Cells       []capacityCell `json:"cells"`
}

type capacityResponse struct {
	From     string           `json:"from"`
	To       string           `json:"to"`
	Weeks    []string         `json:"weeks"`
	Weekends string           `json:"weekends"`
	Total    int              `json:"total"`
	Limit    int              `json:"limit"`
	Offset   int              `json:"offset"`
	People   []capacityPerson `json:"people"`
}

const capacityQuery = `
WITH days AS (
  SELECT d::date AS day,
         date_trunc('week', d)::date AS week_start,
         extract(isodow FROM d) >= 6 AS is_weekend
  FROM generate_series($1::date, $2::date, interval '1 day') AS d
),
allocations AS (
  SELECT a.person_id,
         days.week_start,
         sum(a.hours_per_day) FILTER (WHERE NOT days.is_weekend) AS weekday_hours,
         sum(a.hours_per_day) FILTER (WHERE days.is_weekend)     AS weekend_hours
  FROM assignments a
  JOIN days ON days.day BETWEEN a.start_date AND a.end_date
  WHERE a.start_date <= $2 AND a.end_date >= $1
  GROUP BY a.person_id, days.week_start
),
cells AS (
  SELECT p.id, p.name, p.weekly_hours, w.week_start,
         coalesce(al.weekday_hours, 0)
           + CASE WHEN $3 THEN coalesce(al.weekend_hours, 0) ELSE 0 END AS allocated,
         coalesce(al.weekend_hours, 0) AS weekend
  FROM people p
  CROSS JOIN (SELECT DISTINCT week_start FROM days) w
  LEFT JOIN allocations al ON al.person_id = p.id AND al.week_start = w.week_start
),
rows AS (
  SELECT id, name, weekly_hours,
         array_agg(allocated::float8 ORDER BY week_start)    AS allocated,
         array_agg(weekend::float8 ORDER BY week_start)      AS weekend,
         array_agg(weekly_hours::float8 ORDER BY week_start) AS capacity
  FROM cells
  GROUP BY id, name, weekly_hours
  HAVING NOT $4 OR bool_or(allocated > weekly_hours)
)
-- LEFT JOIN so the total still comes back when the page is past the end.
SELECT total.n, page.id, page.name, page.weekly_hours::float8,
       page.allocated, page.weekend, page.capacity
FROM (SELECT count(*) AS n FROM rows) total
LEFT JOIN LATERAL (
  SELECT * FROM rows ORDER BY name, id LIMIT $5 OFFSET $6
) page ON true`

// handleCapacity serves GET /api/capacity?from=&to=&weekends=separate|count&over=&limit=&offset=
//
// from/to snap out to whole Monday–Sunday weeks. Weekday hours count against
// capacity; weekend hours are reported separately unless weekends=count.
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	from, err := time.Parse(dateLayout, q.Get("from"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "from must be a date (YYYY-MM-DD)")
		return
	}
	to, err := time.Parse(dateLayout, q.Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "to must be a date (YYYY-MM-DD)")
		return
	}
	if to.Before(from) {
		writeError(w, http.StatusBadRequest, "to must not be before from")
		return
	}
	from = startOfWeek(from)
	to = startOfWeek(to).AddDate(0, 0, 6)
	weekCount := int(to.Sub(from).Hours()/24+1) / 7
	if weekCount > maxWeeks {
		writeError(w, http.StatusBadRequest, "range must be at most "+strconv.Itoa(maxWeeks)+" weeks")
		return
	}

	weekends := q.Get("weekends")
	if weekends == "" {
		weekends = "separate"
	}
	if weekends != "separate" && weekends != "count" {
		writeError(w, http.StatusBadRequest, "weekends must be separate or count")
		return
	}

	overOnly := false
	if v := q.Get("over"); v != "" {
		if overOnly, err = strconv.ParseBool(v); err != nil {
			writeError(w, http.StatusBadRequest, "over must be true or false")
			return
		}
	}

	limit, ok := intParam(w, q.Get("limit"), "limit", defaultLimit, 1, maxLimit)
	if !ok {
		return
	}
	offset, ok := intParam(w, q.Get("offset"), "offset", 0, 0, 1<<31-1)
	if !ok {
		return
	}

	rows, err := s.db.Query(r.Context(), capacityQuery, from, to, weekends == "count", overOnly, limit, offset)
	if err != nil {
		log.Printf("capacity query: %v", err)
		writeError(w, http.StatusInternalServerError, "could not load capacity")
		return
	}
	defer rows.Close()

	resp := capacityResponse{
		From:     from.Format(dateLayout),
		To:       to.Format(dateLayout),
		Weeks:    make([]string, weekCount),
		Weekends: weekends,
		Limit:    limit,
		Offset:   offset,
		People:   []capacityPerson{},
	}
	for i := range resp.Weeks {
		resp.Weeks[i] = from.AddDate(0, 0, 7*i).Format(dateLayout)
	}

	for rows.Next() {
		var (
			id                           *int32
			name                         *string
			weeklyHours                  *float64
			allocated, weekend, capacity []float64
		)
		if err := rows.Scan(&resp.Total, &id, &name, &weeklyHours, &allocated, &weekend, &capacity); err != nil {
			log.Printf("capacity scan: %v", err)
			writeError(w, http.StatusInternalServerError, "could not load capacity")
			return
		}
		if id == nil {
			continue
		}
		p := capacityPerson{ID: *id, Name: *name, WeeklyHours: *weeklyHours, Cells: make([]capacityCell, len(allocated))}
		for i := range allocated {
			p.Cells[i] = capacityCell{Allocated: allocated[i], Weekend: weekend[i], Capacity: capacity[i]}
		}
		resp.People = append(resp.People, p)
	}
	if err := rows.Err(); err != nil {
		log.Printf("capacity rows: %v", err)
		writeError(w, http.StatusInternalServerError, "could not load capacity")
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func startOfWeek(t time.Time) time.Time {
	return t.AddDate(0, 0, -((int(t.Weekday()) + 6) % 7))
}

func intParam(w http.ResponseWriter, raw, name string, def, min, max int) (int, bool) {
	if raw == "" {
		return def, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		writeError(w, http.StatusBadRequest, name+" must be an integer between "+strconv.Itoa(min)+" and "+strconv.Itoa(max))
		return 0, false
	}
	return n, true
}

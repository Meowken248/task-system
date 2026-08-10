package timezone

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerReturnsLegacyTimezoneShape(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/timezones/", nil)
	response := httptest.NewRecorder()
	Handler{}.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var body struct {
		Timezones []map[string]any `json:"timezones"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Timezones) < 100 {
		t.Fatalf("timezone count = %d, want at least 100", len(body.Timezones))
	}
	for _, key := range []string{"utc_offset", "gmt_offset", "value", "label"} {
		if _, ok := body.Timezones[0][key]; !ok {
			t.Fatalf("first timezone is missing %q", key)
		}
	}
	if _, ok := body.Timezones[0]["offset"]; ok {
		t.Fatal("internal offset must not be serialized")
	}
}

func TestFormatOffsetMatchesLegacyNegativeFractionalBehavior(t *testing.T) {
	if got := formatOffset(-(3*3600 + 30*60)); got != "-04:30" {
		t.Fatalf("formatOffset = %q, want legacy -04:30", got)
	}
}

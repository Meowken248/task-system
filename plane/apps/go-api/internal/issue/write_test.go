package issue

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestWritePayloadTracksOmittedAndNullFields(t *testing.T) {
	var payload WritePayload
	if err := json.Unmarshal([]byte(`{"name":"Task","target_date":null,"assignees":[]}`), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.has("target_date", "assignees") {
		t.Fatal("explicit null/empty fields must be tracked as present")
	}
	if payload.has("priority") {
		t.Fatal("omitted priority must not be tracked as present")
	}
	if payload.TargetDate != nil {
		t.Fatal("target_date null must decode to nil")
	}
}

func TestValidateCreatePayload(t *testing.T) {
	name := " Task "
	priority := "high"
	got, err := validateCreatePayload(WritePayload{Name: &name, Priority: &priority})
	if err != nil || got != "Task" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	bad := "invalid"
	_, err = validateCreatePayload(WritePayload{Name: &name, Priority: &bad})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid, got %v", err)
	}
}

func TestParseDate(t *testing.T) {
	valid := "2026-07-28"
	if value, err := parseDate(&valid); err != nil || value == nil {
		t.Fatalf("valid date: value=%v err=%v", value, err)
	}
	invalid := "28/07/2026"
	if _, err := parseDate(&invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid, got %v", err)
	}
}

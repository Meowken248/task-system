package tracking

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadLegacyJSON(t *testing.T) {
	directory := t.TempDir()
	data := `[{"event_type":"create_task","issue_id":"00000000-0000-4000-8000-000000000001"}]`
	if err := os.WriteFile(filepath.Join(directory, "blockchain-data.json"), []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	records, files, err := readLegacyJSON(directory)
	if err != nil {
		t.Fatal(err)
	}
	if files != 1 || len(records) != 1 || records[0]["event_type"] != "create_task" {
		t.Fatalf("files=%d records=%#v", files, records)
	}
}

func TestReadLegacyJSONRejectsInvalidFile(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "daily-reports.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readLegacyJSON(directory); err == nil {
		t.Fatal("expected invalid legacy JSON to fail")
	}
}

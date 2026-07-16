import json

import pytest

from plane.api.views.blockchain_tracking import _read_records, _upsert_record, _write_records


@pytest.mark.unit
def test_blockchain_tracking_file_round_trip_and_upsert(tmp_path):
    path = tmp_path / "blockchain-data.json"
    first = {"transaction_hash": "0xABC", "issue_id": "issue-1", "issue_name": "Initial"}
    updated = {"transaction_hash": "0xabc", "issue_id": "issue-1", "issue_name": "Updated"}

    _write_records(path, _upsert_record([], first))
    _write_records(path, _upsert_record(_read_records(path), updated))

    assert _read_records(path) == [updated]
    assert json.loads(path.read_text(encoding="utf-8")) == [updated]
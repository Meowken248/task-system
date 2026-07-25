import json
from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from rest_framework import status

from plane.api.views import blockchain_tracking
from plane.api.views.blockchain_tracking import (
    BlockchainTrackingEndpoint,
    TrackingStorageError,
    _apply_event_side_effects,
    _has_same_identity,
    _read_records,
    _upsert_record,
    _write_records,
)


class _FirstResult:
    def __init__(self, value):
        self.value = value

    def filter(self, **_kwargs):
        return self

    def first(self):
        return self.value


class _AssigneeRows:
    def __init__(self):
        self.deleted = False

    def exclude(self, **_kwargs):
        return self

    def delete(self):
        self.deleted = True

    def exists(self):
        return False


class _AdminMembership:
    def filter(self, **_kwargs):
        return self

    def exists(self):
        return True


def _tracking_request():
    return SimpleNamespace(
        user=SimpleNamespace(id="admin-1"),
        data={
            "event_type": "create_task",
            "issue_id": "issue-1",
            "issue_name": "Task",
            "transaction_hash": "0x" + "44" * 32,
            "contract_address": "0x" + "11" * 20,
            "chain_id": 991,
        },
    )


def _configure_endpoint_mocks(monkeypatch, tmp_path):
    tracking_path = tmp_path / "blockchain-data.json"
    monkeypatch.setattr(blockchain_tracking, "_tracking_file_path", lambda _event_type=None: tracking_path)
    monkeypatch.setattr(blockchain_tracking.ProjectMember.objects, "filter", lambda **_kwargs: _AdminMembership())
    monkeypatch.setattr(blockchain_tracking.transaction, "atomic", nullcontext)
    monkeypatch.setattr(
        blockchain_tracking,
        "_verify_blockchain_transaction",
        lambda _payload: {
            "receipt_status": 1,
            "on_chain_task_id": 5,
            "task_binding_verified": True,
        },
    )
    return tracking_path


@pytest.mark.unit
def test_blockchain_tracking_file_round_trip_and_upsert(tmp_path):
    path = tmp_path / "blockchain-data.json"
    first = {"transaction_hash": "0xABC", "issue_id": "issue-1", "issue_name": "Initial"}
    updated = {"transaction_hash": "0xabc", "issue_id": "issue-1", "issue_name": "Updated"}

    _write_records(path, _upsert_record([], first))
    _write_records(path, _upsert_record(_read_records(path), updated))

    assert _read_records(path) == [updated]
    assert json.loads(path.read_text(encoding="utf-8")) == [updated]


@pytest.mark.unit
def test_off_chain_report_upsert_uses_client_report_id():
    first = {
        "client_report_id": "report-1",
        "event_type": "daily_report",
        "progress": 20,
    }
    updated = {**first, "persistence_status": "committed"}

    assert _upsert_record(_upsert_record([], first), updated) == [updated]


@pytest.mark.unit
def test_corrupt_tracking_file_fails_closed(tmp_path):
    path = tmp_path / "blockchain-data.json"
    path.write_text("{broken", encoding="utf-8")

    with pytest.raises(TrackingStorageError):
        _read_records(path)


@pytest.mark.unit
def test_idempotency_rejects_same_hash_with_different_semantics():
    existing = {
        "event_type": "daily_report",
        "issue_id": "issue-1",
        "contract_address": "0x" + "11" * 20,
        "chain_id": 991,
        "progress": 40,
        "work": "first",
        "difficulty": "",
        "evidence": "",
    }

    assert _has_same_identity(existing, dict(existing))
    assert not _has_same_identity(existing, {**existing, "progress": 80})


@pytest.mark.unit
def test_assignment_sync_populates_issue_assignee_scope(monkeypatch):
    member = SimpleNamespace(member_id="employee-1")
    issue = SimpleNamespace(
        id="issue-1",
        project_id="project-1",
        workspace_id="workspace-1",
        created_by_id="admin-1",
        updated_by_id=None,
    )
    rows = _AssigneeRows()
    created = {}

    monkeypatch.setattr(blockchain_tracking.ProjectMember.objects, "filter", lambda **_kwargs: _FirstResult(member))
    monkeypatch.setattr(
        blockchain_tracking.Issue.objects,
        "select_for_update",
        lambda: _FirstResult(issue),
    )
    monkeypatch.setattr(blockchain_tracking.IssueAssignee.objects, "filter", lambda **_kwargs: rows)
    monkeypatch.setattr(blockchain_tracking.IssueAssignee.objects, "create", lambda **kwargs: created.update(kwargs))

    _apply_event_side_effects(
        event_type="assign_task",
        payload={"issue_id": "issue-1", "assignee_id": "employee-1"},
        slug="workspace",
        project_id="project-1",
    )

    assert rows.deleted is True
    assert created["assignee_id"] == "employee-1"
    assert created["project_id"] == "project-1"
    assert created["workspace_id"] == "workspace-1"


@pytest.mark.unit
def test_tracking_endpoint_commits_verified_event(monkeypatch, tmp_path):
    tracking_path = _configure_endpoint_mocks(monkeypatch, tmp_path)

    response = BlockchainTrackingEndpoint().post(
        _tracking_request(), slug="workspace", project_id="project-1"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["persistence_status"] == "committed"
    assert _read_records(tracking_path)[0]["persistence_status"] == "committed"


@pytest.mark.unit
def test_tracking_endpoint_accepts_assigned_employee_off_chain_report(monkeypatch, tmp_path):
    reports_path = tmp_path / "daily-reports.json"
    user = SimpleNamespace(
        id="employee-1",
        display_name="Employee",
        email="employee@example.com",
    )
    request = SimpleNamespace(
        user=user,
        data={
            "event_type": "daily_report",
            "issue_id": "issue-1",
            "issue_name": "Task",
            "client_event_id": "report-1",
            "on_chain": False,
            "progress": 65,
            "work": "Implemented fallback",
            "difficulty": "",
            "evidence": "",
        },
    )
    monkeypatch.setattr(blockchain_tracking, "_tracking_file_path", lambda _event_type=None: reports_path)
    monkeypatch.setattr(blockchain_tracking.ProjectMember.objects, "filter", lambda **_kwargs: _AdminMembership())
    monkeypatch.setattr(
        blockchain_tracking.Issue.objects,
        "filter",
        lambda **_kwargs: _FirstResult(SimpleNamespace(id="issue-1")),
    )
    monkeypatch.setattr(blockchain_tracking.transaction, "atomic", nullcontext)
    monkeypatch.setattr(blockchain_tracking, "_apply_event_side_effects", lambda **_kwargs: None)
    monkeypatch.setattr(
        blockchain_tracking,
        "_verify_blockchain_transaction",
        lambda _payload: (_ for _ in ()).throw(AssertionError("off-chain report must not call RPC")),
    )

    response = BlockchainTrackingEndpoint().post(
        request, slug="workspace", project_id="project-1"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["on_chain"] is False
    assert response.data["verification_status"] == "not_requested"
    assert response.data["report_id"] == "report-1"
    assert _read_records(reports_path)[0]["progress"] == 65


@pytest.mark.unit
def test_tracking_endpoint_does_not_bypass_verification_without_explicit_off_chain_flag():
    request = SimpleNamespace(
        user=SimpleNamespace(id="employee-1"),
        data={
            "event_type": "daily_report",
            "issue_id": "issue-1",
            "client_report_id": "report-1",
            "progress": 65,
        },
    )

    response = BlockchainTrackingEndpoint().post(
        request, slug="workspace", project_id="project-1"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "transaction_hash" in response.data["error"]


@pytest.mark.unit
def test_tracking_endpoint_keeps_pending_event_when_plane_sync_fails(monkeypatch, tmp_path):
    tracking_path = _configure_endpoint_mocks(monkeypatch, tmp_path)
    monkeypatch.setattr(
        blockchain_tracking,
        "_apply_event_side_effects",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )

    response = BlockchainTrackingEndpoint().post(
        _tracking_request(), slug="workspace", project_id="project-1"
    )

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert _read_records(tracking_path)[0]["persistence_status"] == "pending"

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
import os
from pathlib import Path
from threading import Lock

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.permissions import ProjectEntityPermission


_tracking_file_lock = Lock()
_ALLOWED_FIELDS = {
    "issue_id",
    "issue_name",
    "project_id",
    "workspace_slug",
    "wallet_address",
    "assignee_wallet",
    "assignee_id",
    "assignee_name",
    "contract_address",
    "chain_id",
    "transaction_hash",
    "event_type",
    "progress",
    "work",
    "difficulty",
    "evidence",
}
_REQUIRED_FIELDS = {"issue_id", "transaction_hash"}


def _tracking_file_path(event_type: str | None = None) -> Path:
    file_config = {
        "daily_report": ("DAILY_REPORTS_FILE", "daily-reports.json"),
        "assign_task": ("TASK_ASSIGNMENTS_FILE", "task-assignments.json"),
    }
    environment_key, filename = file_config.get(
        event_type,
        ("BLOCKCHAIN_TRACKING_FILE", "blockchain-data.json"),
    )
    configured_path = os.environ.get(environment_key)
    if configured_path:
        return Path(configured_path).expanduser().resolve()
    return Path(settings.BASE_DIR).parent / filename


def _read_records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def _write_records(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    temporary_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def _upsert_record(records: list[dict], payload: dict) -> list[dict]:
    transaction_hash = str(payload["transaction_hash"]).lower()
    existing_index = next(
        (
            index
            for index, record in enumerate(records)
            if str(record.get("transaction_hash", "")).lower() == transaction_hash
        ),
        None,
    )
    if existing_index is None:
        return [payload, *records]
    records[existing_index] = payload
    return records


class BlockchainTrackingEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def get(self, request, slug, project_id):
        with _tracking_file_lock:
            records = (
                _read_records(_tracking_file_path())
                + _read_records(_tracking_file_path("daily_report"))
                + _read_records(_tracking_file_path("assign_task"))
            )
        filtered = [
            record
            for record in records
            if record.get("workspace_slug") == slug and record.get("project_id") == str(project_id)
        ]
        return Response(filtered, status=status.HTTP_200_OK)

    def post(self, request, slug, project_id):
        payload = {key: request.data.get(key) for key in _ALLOWED_FIELDS if key in request.data}
        missing = [key for key in _REQUIRED_FIELDS if not payload.get(key)]
        if missing:
            return Response(
                {"error": f"Missing required fields: {', '.join(sorted(missing))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload["workspace_slug"] = slug
        payload["project_id"] = str(project_id)
        payload["recorded_at"] = timezone.now().isoformat()

        path = _tracking_file_path(payload.get("event_type"))
        with _tracking_file_lock:
            records = _read_records(path)
            records = _upsert_record(records, payload)
            _write_records(path, records)

        return Response(payload, status=status.HTTP_201_CREATED)
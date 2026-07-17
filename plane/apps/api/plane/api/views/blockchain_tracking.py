# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
import os
import uuid
from pathlib import Path
from threading import Lock

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import Issue, ProjectMember, State, WorkspaceMember
from plane.db.models.project import ROLE


_tracking_file_lock = Lock()
_ALLOWED_FIELDS = {
    "issue_id",
    "issue_name",
    "parent_issue_id",
    "target_date",
    "priority",
    "project_id",
    "workspace_slug",
    "wallet_address",
    "assignee_wallet",
    "assignee_id",
    "assignee_name",
    "reporter_id",
    "reporter_name",
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
        active_issue_ids = {
            str(issue_id)
            for issue_id in Issue.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                deleted_at__isnull=True,
                id__in=[record.get("issue_id") for record in filtered if record.get("issue_id")],
            ).values_list("id", flat=True)
        }
        filtered = [record for record in filtered if str(record.get("issue_id")) in active_issue_ids]
        member_names = {
            str(member.member_id): member.member.display_name or member.member.email or str(member.member_id)
            for member in ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                is_active=True,
            ).select_related("member")
        }
        issue_assignees = {
            str(issue.id): next(iter(issue.assignees.values_list("id", flat=True)), None)
            for issue in Issue.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                id__in=[record.get("issue_id") for record in filtered if record.get("issue_id")],
            ).prefetch_related("assignees")
        }
        for record in filtered:
            assignee_id = record.get("assignee_id")
            if assignee_id and not record.get("assignee_name"):
                record["assignee_name"] = member_names.get(str(assignee_id), str(assignee_id))
            if record.get("event_type") == "daily_report" and not record.get("reporter_name"):
                reporter_id = issue_assignees.get(str(record.get("issue_id")))
                if reporter_id:
                    record["reporter_id"] = str(reporter_id)
                    record["reporter_name"] = member_names.get(str(reporter_id), str(reporter_id))
        return Response(filtered, status=status.HTTP_200_OK)

    def post(self, request, slug, project_id):
        payload = {key: request.data.get(key) for key in _ALLOWED_FIELDS if key in request.data}
        event_type = payload.get("event_type")
        project_membership = ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            is_active=True,
        )
        is_admin = project_membership.filter(role=ROLE.ADMIN.value).exists() or (
            project_membership.exists()
            and WorkspaceMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=ROLE.ADMIN.value,
                is_active=True,
            ).exists()
        )
        if event_type in {"create_task", "assign_task", "delete_task"} and not is_admin:
            return Response({"error": "Admin permission required."}, status=status.HTTP_403_FORBIDDEN)

        issue = None
        assignment_member = None
        assigned_issue = None
        if event_type == "assign_task":
            assignment_member = ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member_id=payload.get("assignee_id"),
                is_active=True,
            ).first()
            assigned_issue = Issue.objects.filter(
                id=payload.get("issue_id"),
                workspace__slug=slug,
                project_id=project_id,
            ).first()
            if assignment_member is None or assigned_issue is None:
                return Response(
                    {"error": "Task or employee was not found."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if event_type == "daily_report":
            issue = Issue.objects.filter(
                id=payload.get("issue_id"),
                workspace__slug=slug,
                project_id=project_id,
                assignees=request.user,
            ).first()
            if issue is None:
                return Response(
                    {"error": "Only the assigned employee can submit this report."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            try:
                progress = int(payload.get("progress"))
            except (TypeError, ValueError):
                return Response({"error": "Progress must be an integer."}, status=status.HTTP_400_BAD_REQUEST)
            if progress < 0 or progress > 100:
                return Response({"error": "Progress must be between 0 and 100."}, status=status.HTTP_400_BAD_REQUEST)
            payload["progress"] = progress
            payload["reporter_id"] = str(request.user.id)
            payload["reporter_name"] = request.user.display_name or request.user.email or str(request.user.id)

        if payload.get("assignee_id") and not payload.get("assignee_name"):
            member = assignment_member or ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member_id=payload["assignee_id"],
                is_active=True,
            ).select_related("member").first()
            if member is not None:
                payload["assignee_name"] = (
                    member.member.display_name or member.member.email or str(member.member_id)
                )

        missing = [key for key in _REQUIRED_FIELDS if not payload.get(key)]
        if missing:
            return Response(
                {"error": f"Missing required fields: {', '.join(sorted(missing))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload["workspace_slug"] = slug
        payload["project_id"] = str(project_id)
        payload["recorded_at"] = timezone.now().isoformat()
        if event_type == "daily_report":
            payload["report_id"] = str(uuid.uuid4())

        path = _tracking_file_path(event_type)
        with _tracking_file_lock:
            records = _read_records(path)
            records = [payload, *records] if event_type == "daily_report" else _upsert_record(records, payload)
            _write_records(path, records)

        if event_type == "assign_task" and assignment_member is not None and assigned_issue is not None:
            assigned_issue.assignees.set([assignment_member.member_id])

        if event_type == "daily_report" and issue is not None:
            state_groups = (
                ["completed"]
                if payload["progress"] == 100
                else ["started"]
                if payload["progress"] > 0
                else ["unstarted", "backlog"]
            )
            target_state = next(
                (
                    State.objects.filter(project_id=project_id, group=group).order_by("sequence").first()
                    for group in state_groups
                    if State.objects.filter(project_id=project_id, group=group).exists()
                ),
                None,
            )
            if target_state is not None and issue.state_id != target_state.id:
                issue.state = target_state
                issue.save(update_fields=["state", "updated_at"])

        return Response(payload, status=status.HTTP_201_CREATED)

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
import json
import logging
import os
import re
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from threading import Lock

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.api.views.blockchain_verification import (
    BlockchainVerificationError,
    verify_blockchain_transaction as _verify_blockchain_transaction,
)
from plane.app.views.base import BaseAPIView
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import Issue, IssueAssignee, ProjectMember, State, WorkspaceMember
from plane.db.models.project import ROLE


logger = logging.getLogger(__name__)
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
    "client_report_id",
    "client_event_id",
    "on_chain",
    "event_type",
    "progress",
    "work",
    "difficulty",
    "evidence",
    "content_kind",
    "content_reference",
    "content_hash",
}
_ALLOWED_EVENT_TYPES = {
    "create_task",
    "assign_task",
    "daily_report",
    "delete_task",
    "task_content",
}
_REQUIRED_FIELDS = {
    "event_type",
    "issue_id",
    "transaction_hash",
    "contract_address",
    "chain_id",
}
_EVENT_REQUIRED_FIELDS = {
    "assign_task": {"assignee_id", "assignee_wallet"},
    "daily_report": {"progress"},
    "task_content": {"content_kind", "content_reference", "content_hash"},
}
_IDEMPOTENCY_FIELDS = {
    "assign_task": {"assignee_id", "assignee_wallet"},
    "daily_report": {"progress", "work", "difficulty", "evidence"},
    "task_content": {"content_kind", "content_reference", "content_hash"},
}


class TrackingStorageError(OSError):
    """Tracking data cannot be read without risking data loss."""


def _tracking_file_path(event_type: str | None = None) -> Path:
    file_config = {
        "daily_report": ("DAILY_REPORTS_FILE", "daily-reports.json"),
        "assign_task": ("TASK_ASSIGNMENTS_FILE", "task-assignments.json"),
        "task_content": ("TASK_CONTENT_FILE", "task-content.json"),
    }
    environment_key, filename = file_config.get(
        event_type,
        ("BLOCKCHAIN_TRACKING_FILE", "blockchain-data.json"),
    )
    configured_path = os.environ.get(environment_key)
    if configured_path:
        return Path(configured_path).expanduser().resolve()
    return Path(settings.BASE_DIR).parent / filename


@contextmanager
def _tracking_storage_lock(timeout_seconds: float = 10.0):
    """Serialize JSON updates across threads and API worker processes."""

    lock_path = _tracking_file_path().with_name(".blockchain-tracking.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with _tracking_file_lock:
        deadline = time.monotonic() + timeout_seconds
        lock_fd = None
        while lock_fd is None:
            try:
                lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    if time.time() - lock_path.stat().st_mtime > 60:
                        lock_path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() >= deadline:
                    raise TimeoutError("Timed out waiting for the blockchain tracking file lock.")
                time.sleep(0.05)
        try:
            yield
        finally:
            os.close(lock_fd)
            lock_path.unlink(missing_ok=True)


def _read_records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise TrackingStorageError(f"Unable to read blockchain tracking file: {path}") from exc
    if not isinstance(data, list) or any(not isinstance(record, dict) for record in data):
        raise TrackingStorageError(f"Blockchain tracking file has an invalid structure: {path}")
    return data


def _write_records(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(
        f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        temporary_path.write_text(
            json.dumps(records, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _upsert_record(records: list[dict], payload: dict) -> list[dict]:
    transaction_hash = str(payload.get("transaction_hash", "")).lower()
    client_event_id = str(
        payload.get("client_event_id") or payload.get("client_report_id") or ""
    )
    existing_index = next(
        (
            index
            for index, record in enumerate(records)
            if (
                transaction_hash
                and str(record.get("transaction_hash", "")).lower() == transaction_hash
            )
            or (
                client_event_id
                and str(
                    record.get("client_event_id")
                    or record.get("client_report_id")
                    or ""
                )
                == client_event_id
            )
        ),
        None,
    )
    if existing_index is None:
        return [payload, *records]
    records[existing_index] = payload
    return records


def _find_existing_record(paths: set[Path], transaction_hash: str) -> tuple[Path | None, dict | None]:
    for tracking_path in paths:
        for record in _read_records(tracking_path):
            if str(record.get("transaction_hash", "")).lower() == transaction_hash:
                return tracking_path, record
    return None, None


def _find_creation_record(*, issue_id: str, slug: str, project_id) -> dict | None:
    return next(
        (
            record
            for record in _read_records(_tracking_file_path())
            if record.get("event_type") == "create_task"
            and str(record.get("issue_id")) == str(issue_id)
            and record.get("workspace_slug") == slug
            and str(record.get("project_id")) == str(project_id)
            and record.get("on_chain_task_id") is not None
        ),
        None,
    )


def _normalize_identity(field: str, value):
    if field in {"contract_address", "assignee_wallet"}:
        return str(value or "").lower()
    if field == "chain_id":
        text = str(value).strip().lower()
        try:
            return int(text, 16 if text.startswith("0x") else 10)
        except (TypeError, ValueError):
            return text
    if field in {"issue_id", "assignee_id"}:
        return str(value or "")
    return value


def _has_same_identity(existing: dict, incoming: dict) -> bool:
    event_type = str(incoming.get("event_type", ""))
    fields = {
        "event_type",
        "issue_id",
        "contract_address",
        "chain_id",
        *_IDEMPOTENCY_FIELDS.get(event_type, set()),
    }
    return all(
        _normalize_identity(field, existing.get(field))
        == _normalize_identity(field, incoming.get(field))
        for field in fields
    )


def _apply_event_side_effects(*, event_type: str, payload: dict, slug: str, project_id) -> None:
    """Idempotently mirror a verified event into Plane."""

    if event_type == "assign_task":
        member = ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member_id=payload.get("assignee_id"),
            is_active=True,
        ).first()
        issue = Issue.objects.select_for_update().filter(
            id=payload.get("issue_id"), workspace__slug=slug, project_id=project_id
        ).first()
        if member is None or issue is None:
            raise ValueError("Task or employee was not found.")
        # Issue.assignees uses the custom IssueAssignee through model. Django's
        # generic ManyToMany ``set`` does not populate the required Plane
        # project/workspace columns and therefore raises a NOT NULL violation.
        # Keep this mirror idempotent and create the through row explicitly.
        IssueAssignee.objects.filter(issue=issue).exclude(assignee_id=member.member_id).delete()
        if not IssueAssignee.objects.filter(issue=issue, assignee_id=member.member_id).exists():
            audit_user_id = issue.updated_by_id or issue.created_by_id
            IssueAssignee.objects.create(
                issue=issue,
                assignee_id=member.member_id,
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                created_by_id=audit_user_id,
                updated_by_id=audit_user_id,
            )
        return
    if event_type == "delete_task":
        issue = Issue.objects.select_for_update().filter(
            id=payload.get("issue_id"), workspace__slug=slug, project_id=project_id, deleted_at__isnull=True
        ).first()
        if issue is not None:
            Issue.objects.filter(parent_id=issue.id).update(parent_id=None)
            issue.delete()
        return
    if event_type != "daily_report":
        return
    issue = Issue.objects.select_for_update().filter(
        id=payload.get("issue_id"), workspace__slug=slug, project_id=project_id
    ).first()
    if issue is None:
        raise ValueError("Task was not found.")
    groups = (
        ["completed"]
        if payload["progress"] == 100
        else ["started"]
        if payload["progress"] > 0
        else ["unstarted", "backlog"]
    )
    target_state = next(
        (
            State.objects.filter(project_id=project_id, group=group)
            .order_by("sequence")
            .first()
            for group in groups
            if State.objects.filter(project_id=project_id, group=group).exists()
        ),
        None,
    )
    if target_state is not None and issue.state_id != target_state.id:
        issue.state = target_state
        issue.save(update_fields=["state", "updated_at"])


def _load_and_recover_pending(*, slug: str, project_id) -> list[dict]:
    paths = {
        _tracking_file_path(),
        _tracking_file_path("daily_report"),
        _tracking_file_path("assign_task"),
        _tracking_file_path("task_content"),
    }
    loaded: list[dict] = []
    for path in paths:
        records = _read_records(path)
        changed = False
        for index, record in enumerate(records):
            if (
                record.get("persistence_status") != "pending"
                or record.get("workspace_slug") != slug
                or str(record.get("project_id")) != str(project_id)
            ):
                continue
            try:
                with transaction.atomic():
                    _apply_event_side_effects(
                        event_type=str(record.get("event_type", "")), payload=record, slug=slug, project_id=project_id
                    )
            except Exception:
                logger.exception("Unable to recover blockchain transaction %s", record.get("transaction_hash"))
                continue
            records[index] = {**record, "persistence_status": "committed", "recovered_at": timezone.now().isoformat()}
            changed = True
        if changed:
            _write_records(path, records)
        loaded.extend(records)
    return loaded


class BlockchainTrackingEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def get(self, request, slug, project_id):
        try:
            with _tracking_storage_lock():
                records = _load_and_recover_pending(slug=slug, project_id=project_id)
        except (OSError, TimeoutError):
            logger.exception("Unable to load blockchain tracking data")
            return Response(
                {"error": "Blockchain tracking storage is unavailable or invalid."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        filtered = [
            record
            for record in records
            if record.get("workspace_slug") == slug
            and record.get("project_id") == str(project_id)
            and record.get("persistence_status", "committed") == "committed"
        ]
        requested_assignee_id = request.query_params.get("assignee_id")
        if requested_assignee_id:
            filtered = [
                record
                for record in filtered
                if record.get("event_type") == "assign_task"
                and str(record.get("assignee_id")) == requested_assignee_id
            ]
        else:
            active_issue_ids = {
                str(issue_id)
                for issue_id in Issue.objects.filter(
                    workspace__slug=slug,
                    project_id=project_id,
                    deleted_at__isnull=True,
                    id__in=[
                        record.get("issue_id")
                        for record in filtered
                        if record.get("issue_id")
                    ],
                ).values_list("id", flat=True)
            }
            filtered = [
                record
                for record in filtered
                if str(record.get("issue_id")) in active_issue_ids
            ]
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
        if event_type not in _ALLOWED_EVENT_TYPES:
            return Response(
                {"error": "Invalid or missing blockchain event type."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_off_chain_event = (
            event_type in {"create_task", "daily_report"}
            and payload.get("on_chain") is False
        )
        is_off_chain_report = event_type == "daily_report" and is_off_chain_event
        required_fields = _REQUIRED_FIELDS | _EVENT_REQUIRED_FIELDS.get(event_type, set())
        if is_off_chain_event:
            required_fields = {"event_type", "issue_id", "client_event_id"}
            if is_off_chain_report:
                required_fields.add("progress")
        missing = [
            key
            for key in required_fields
            if key not in payload or payload[key] is None or payload[key] == ""
        ]
        if missing:
            return Response(
                {"error": f"Missing required fields: {', '.join(sorted(missing))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not is_off_chain_event and not re.fullmatch(
            r"0x[a-fA-F0-9]{64}", str(payload["transaction_hash"])
        ):
            return Response(
                {"error": "Transaction hash must be a 32-byte 0x-prefixed hexadecimal value."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for address_field in ("contract_address", "assignee_wallet"):
            address = payload.get(address_field)
            if address is not None and not re.fullmatch(r"0x[a-fA-F0-9]{40}", str(address)):
                return Response(
                    {"error": f"{address_field} must be a 20-byte 0x-prefixed hexadecimal address."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

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

        if event_type == "task_content":
            content_issue = Issue.objects.filter(
                id=payload.get("issue_id"),
                workspace__slug=slug,
                project_id=project_id,
            ).first()
            if content_issue is None or (
                not is_admin
                and not content_issue.assignees.filter(id=request.user.id).exists()
            ):
                return Response(
                    {"error": "Only admin or the assigned employee can anchor task content."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if payload.get("content_kind") not in {"comment", "attachment", "evidence"}:
                return Response({"error": "Invalid content kind."}, status=status.HTTP_400_BAD_REQUEST)
            if not re.fullmatch(r"0x[a-fA-F0-9]{64}", str(payload.get("content_hash", ""))):
                return Response(
                    {"error": "Content hash must be a 32-byte 0x-prefixed hexadecimal value."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            payload["content_hash"] = str(payload["content_hash"]).lower()

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

        if event_type != "create_task" and not is_off_chain_event:
            try:
                with _tracking_storage_lock():
                    creation_record = _find_creation_record(
                        issue_id=str(payload["issue_id"]), slug=slug, project_id=project_id
                    )
            except (OSError, TimeoutError):
                return Response(
                    {"error": "Blockchain tracking storage is unavailable or invalid."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            if creation_record is not None:
                payload["expected_on_chain_task_id"] = creation_record["on_chain_task_id"]

        if is_off_chain_event:
            payload["on_chain"] = False
            payload["verification_status"] = "not_requested"
        else:
            try:
                payload.update(_verify_blockchain_transaction(payload))
            except BlockchainVerificationError as exc:
                return Response({"error": str(exc)}, status=exc.status_code)

        payload["workspace_slug"] = slug
        payload["project_id"] = str(project_id)
        payload["recorded_at"] = timezone.now().isoformat()
        if event_type == "daily_report":
            payload["report_id"] = (
                str(payload["client_event_id"]) if is_off_chain_report else str(uuid.uuid4())
            )

        path = _tracking_file_path(event_type)
        transaction_hash = str(payload.get("transaction_hash", "")).lower()
        paths = {
            _tracking_file_path(),
            _tracking_file_path("daily_report"),
            _tracking_file_path("assign_task"),
            _tracking_file_path("task_content"),
        }
        is_idempotent = False
        try:
            with _tracking_storage_lock():
                existing_path, existing_record = (None, None)
                if transaction_hash:
                    existing_path, existing_record = _find_existing_record(paths, transaction_hash)
                elif is_off_chain_event:
                    existing_record = next(
                        (
                            record
                            for record in _read_records(path)
                            if (
                                record.get("client_event_id")
                                or record.get("client_report_id")
                            )
                            == payload.get("client_event_id")
                        ),
                        None,
                    )
                    if existing_record is not None:
                        existing_path = path
                if existing_record is not None:
                    is_idempotent = (
                        _has_same_identity(existing_record, payload)
                        and existing_record.get("workspace_slug") == slug
                        and str(existing_record.get("project_id")) == str(project_id)
                    )
                    if not is_idempotent:
                        return Response(
                            {"error": "Transaction hash is already linked to another blockchain event."},
                            status=status.HTTP_409_CONFLICT,
                        )
                    payload = {**existing_record, **payload}
                    path = existing_path or path
                payload["persistence_status"] = "pending"
                _write_records(path, _upsert_record(_read_records(path), payload))
                with transaction.atomic():
                    _apply_event_side_effects(
                        event_type=event_type, payload=payload, slug=slug, project_id=project_id
                    )
                payload["persistence_status"] = "committed"
                _write_records(path, _upsert_record(_read_records(path), payload))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Verified blockchain event is pending Plane synchronization")
            return Response(
                {
                    "error": (
                        "The blockchain event was verified but synchronization is pending. "
                        "Retry the same transaction hash; no new blockchain transaction is needed."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(payload, status=status.HTTP_200_OK if is_idempotent else status.HTTP_201_CREATED)

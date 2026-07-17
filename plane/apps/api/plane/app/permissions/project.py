# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third Party imports
from rest_framework.permissions import SAFE_METHODS, BasePermission

# Module import
from plane.db.models import ProjectMember, WorkspaceMember
from plane.db.models.project import ROLE


class ProjectBasePermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug, member=request.user, is_active=True
            ).exists()

        ## Only workspace owners or admins can create the projects
        if request.method == "POST":
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug,
                member=request.user,
                role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
                is_active=True,
            ).exists()

        project_member_qs = ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            project_id=view.project_id,
            is_active=True,
        )

        ## Only project admins or workspace admin who is part of the project can access

        if project_member_qs.filter(role=ROLE.ADMIN.value).exists():
            return True
        else:
            return (
                project_member_qs.exists()
                and WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=view.workspace_slug,
                    role=ROLE.ADMIN.value,
                    is_active=True,
                ).exists()
            )


class ProjectMemberPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return ProjectMember.objects.filter(
                workspace__slug=view.workspace_slug, member=request.user, is_active=True
            ).exists()
        ## Only workspace owners or admins can create the projects
        if request.method == "POST":
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug,
                member=request.user,
                role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
                is_active=True,
            ).exists()

        ## Only Project Admins can update project attributes
        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
            project_id=view.project_id,
            is_active=True,
        ).exists()


class ProjectEntityPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        # Handle requests based on project__identifier
        if hasattr(view, "project_identifier") and view.project_identifier:
            if request.method in SAFE_METHODS:
                return ProjectMember.objects.filter(
                    workspace__slug=view.workspace_slug,
                    member=request.user,
                    project__identifier=view.project_identifier,
                    is_active=True,
                ).exists()

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return ProjectMember.objects.filter(
                workspace__slug=view.workspace_slug,
                member=request.user,
                project_id=view.project_id,
                is_active=True,
            ).exists()

        ## Only project members or admins can create and edit the project attributes
        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
            project_id=view.project_id,
            is_active=True,
        ).exists()


class ProjectAdminPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            role=ROLE.ADMIN.value,
            project_id=view.project_id,
            is_active=True,
        ).exists()


class ProjectLitePermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            project_id=view.project_id,
            is_active=True,
        ).exists()


class FiaiTaskPermission(BasePermission):
    """Restrict task mutations to the FIAI Admin/Employee workflow."""

    employee_update_fields = {
        "name",
        "description_html",
        "description_json",
        "description_stripped",
        "description_binary",
        "state_id",
        "skip_activity",
    }

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        slug = view.workspace_slug
        project_id = view.project_id
        membership = ProjectMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            project_id=project_id,
            is_active=True,
        )
        if request.method in SAFE_METHODS:
            return membership.exists()

        is_admin = membership.filter(role=ROLE.ADMIN.value).exists() or (
            membership.exists()
            and WorkspaceMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=ROLE.ADMIN.value,
                is_active=True,
            ).exists()
        )
        if is_admin:
            return True

        if request.method != "PATCH":
            return False
        if not set(request.data.keys()).issubset(self.employee_update_fields):
            return False

        issue_id = view.kwargs.get("pk")
        if not issue_id:
            return False
        from plane.db.models import Issue

        return Issue.objects.filter(
            id=issue_id,
            project_id=project_id,
            workspace__slug=slug,
            assignees=request.user,
        ).exists()

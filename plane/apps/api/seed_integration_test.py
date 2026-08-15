import os
import django
from datetime import timedelta
from django.utils import timezone

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'plane.settings.local')
django.setup()

from plane.db.models import User, Workspace, WorkspaceMember, Project, ProjectMember, State
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.auth import get_user_model

User = get_user_model()

# Create or get user
user, _ = User.objects.get_or_create(
    username="go_test_user",
    defaults={
        "email": "go_test@example.com",
        "first_name": "Go",
        "last_name": "Test",
        "is_active": True,
    }
)
user.set_password("password123")
user.save()

# Create a session using Django's SessionStore
session = SessionStore(session_key="go_test_session_key")
session["_auth_user_id"] = str(user.id)
session.set_expiry(86400) # 1 day
session.save()

# Create workspace
workspace, _ = Workspace.objects.get_or_create(
    slug="test-slug-go",
    defaults={
        "name": "Go Test Workspace",
        "owner": user,
    }
)

# Add member
WorkspaceMember.objects.get_or_create(
    workspace=workspace,
    member=user,
    defaults={"role": 20}
)

# Create project
project, _ = Project.objects.get_or_create(
    identifier="GOT",
    workspace=workspace,
    defaults={
        "name": "Go Test Project",
        "network": 2, # Public
    }
)

# Add project member
ProjectMember.objects.get_or_create(
    project=project,
    member=user,
    workspace=workspace,
    defaults={"role": 20}
)

# Create state
state, _ = State.objects.get_or_create(
    name="Todo",
    project=project,
    workspace=workspace,
    defaults={
        "group": "unstarted",
        "sequence": 10000,
        "color": "#000000",
    }
)

print(f"Data seeded successfully for Go test.")

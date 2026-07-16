# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.blockchain_tracking import BlockchainTrackingEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/blockchain-transactions/",
        BlockchainTrackingEndpoint.as_view(http_method_names=["get", "post"]),
        name="blockchain-transactions",
    ),
]
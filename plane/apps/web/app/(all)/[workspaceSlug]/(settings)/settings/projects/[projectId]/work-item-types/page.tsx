/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { WorkStructureFeaturePage } from "@/components/settings/project/content/work-structure-feature-page";
// local imports
import type { Route } from "./+types/page";

export default function WorkItemTypesSettingsPage({ params }: Route.ComponentProps) {
  return (
    <WorkStructureFeaturePage
      workspaceSlug={params.workspaceSlug}
      projectId={params.projectId}
      title="Work item types"
      description="Enable structured work item types so the project can distinguish different kinds of work."
      toggleTitle="Enable work item types"
      toggleDescription="Allow this project to use work item types stored in Plane."
    />
  );
}

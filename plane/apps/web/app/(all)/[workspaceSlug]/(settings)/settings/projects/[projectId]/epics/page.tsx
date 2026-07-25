/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { WorkStructureFeaturePage } from "@/components/settings/project/content/work-structure-feature-page";
// local imports
import type { Route } from "./+types/page";

export default function EpicsSettingsPage({ params }: Route.ComponentProps) {
  return (
    <WorkStructureFeaturePage
      workspaceSlug={params.workspaceSlug}
      projectId={params.projectId}
      title="Epics"
      description="Use epics to group and organize related work items at a higher level."
      toggleTitle="Enable epics"
      toggleDescription="Enable structured work item types, including epics, for this project."
    />
  );
}

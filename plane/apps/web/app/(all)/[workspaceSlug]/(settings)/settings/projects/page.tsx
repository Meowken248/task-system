/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
import { useParams } from "next/navigation";
// plane imports
import { PROJECT_TRACKER_ELEMENTS } from "@plane/constants";
import { Button } from "@plane/propel/button";
// assets
import ProjectDarkEmptyState from "@/app/assets/empty-state/project-settings/no-projects-dark.png?url";
import ProjectLightEmptyState from "@/app/assets/empty-state/project-settings/no-projects-light.png?url";
// components
import { CreateProjectModal } from "@/components/project/create-project-modal";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";

function ProjectSettingsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // store hooks
  const { resolvedTheme } = useTheme();
  const params = useParams();
  const { currentWorkspace } = useWorkspace();
  const workspaceSlug = (params?.workspaceSlug as string) || currentWorkspace?.slug || "fiai";

  // derived values
  const resolvedPath = resolvedTheme === "dark" ? ProjectDarkEmptyState : ProjectLightEmptyState;
  return (
    <div className="mx-auto flex h-full max-w-[480px] flex-col items-center justify-center gap-4">
      <img src={resolvedPath} alt="No projects yet" />
      <div className="text-16 font-semibold text-tertiary">No projects yet</div>
      <div className="text-center text-13 text-tertiary">
        Projects act as the foundation for goal-driven work. They let you manage your teams, tasks, and everything you
        need to get things done.
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => setIsModalOpen(true)}
          data-ph-element={PROJECT_TRACKER_ELEMENTS.EMPTY_STATE_CREATE_PROJECT_BUTTON}
        >
          Start your first project
        </Button>
      </div>

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}

export default observer(ProjectSettingsPage);

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { ProjectNavigation } from "@/components/workspace/sidebar/project-navigation";
import { useProject } from "@/hooks/store/use-project";
import { getProjectFeatureNavigation } from "../projects/navigation/helper";

type TProjectItemsRootProps = {
  workspaceSlug: string;
  projectId: string;
};

export const ProjectNavigationRoot = observer(function ProjectNavigationRoot(props: TProjectItemsRootProps) {
  const { workspaceSlug, projectId } = props;
  const { getPartialProjectById } = useProject();
  const project = getPartialProjectById(projectId);

  return (
    <ProjectNavigation
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      additionalNavigationItems={(workspaceSlug, projectId) => {
        if (!project) return [];
        return getProjectFeatureNavigation(workspaceSlug, projectId, project).filter(
          (item) => item.key !== "work_items"
        );
      }}
    />
  );
});

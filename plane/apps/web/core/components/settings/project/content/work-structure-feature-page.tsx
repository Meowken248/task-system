/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectSettingsFeatureControlItem } from "@/components/settings/project/content/feature-control-item";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";

type Props = {
  description: string;
  projectId: string;
  title: string;
  toggleDescription: string;
  toggleTitle: string;
  workspaceSlug: string;
};

export const WorkStructureFeaturePage = observer(function WorkStructureFeaturePage(props: Props) {
  const { description, projectId, title, toggleDescription, toggleTitle, workspaceSlug } = props;
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();

  const canPerformProjectAdminActions = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);

  if (workspaceUserInfo && !canPerformProjectAdminActions) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper>
      <PageHead title={currentProjectDetails?.name ? `${currentProjectDetails.name} settings - ${title}` : title} />
      <section className="w-full">
        <SettingsHeading title={title} description={description} />
        <div className="mt-7">
          <ProjectSettingsFeatureControlItem
            title={toggleTitle}
            description={toggleDescription}
            featureProperty="is_issue_type_enabled"
            projectId={projectId}
            value={!!currentProjectDetails?.is_issue_type_enabled}
            workspaceSlug={workspaceSlug}
          />
        </div>
        <p className="mt-4 text-body-xs-regular text-tertiary">
          This setting is stored in the Plane database. It does not connect to a wallet or create an on-chain
          transaction.
        </p>
      </section>
    </SettingsContentWrapper>
  );
});

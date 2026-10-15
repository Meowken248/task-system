/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { IWorkspaceMemberInvitation } from "@plane/types";
import { ECreateOrJoinWorkspaceViews, EOnboardingSteps } from "@plane/types";
// hooks
import { useUser } from "@/hooks/store/user";
import { useWorkspace } from "@/hooks/store/use-workspace";
// local components
import { WorkspaceCreateStep, WorkspaceJoinInvitesStep } from "./";

type Props = {
  invitations: IWorkspaceMemberInvitation[];
  handleStepChange: (step: EOnboardingSteps, skipInvites?: boolean) => void;
};

export const WorkspaceSetupStep = observer(function WorkspaceSetupStep({ invitations, handleStepChange }: Props) {
  // states
  const [currentView, setCurrentView] = useState<ECreateOrJoinWorkspaceViews | null>(null);
  // store hooks
  const { data: user } = useUser();
  const { workspaces } = useWorkspace();
  const workspacesList = Object.values(workspaces ?? {});

  useEffect(() => {
    if (invitations.length > 0) {
      setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_JOIN);
    } else if (workspacesList.length > 0) {
      // User is already a member of at least one workspace — bypass workspace creation and finish onboarding
      handleStepChange(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN, true);
    } else {
      setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_CREATE);
    }
  }, [invitations, workspacesList.length, handleStepChange]);

  return (
    <>
      {currentView === ECreateOrJoinWorkspaceViews.WORKSPACE_JOIN ? (
        <WorkspaceJoinInvitesStep
          invitations={invitations}
          handleNextStep={async () => {
            handleStepChange(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN, true);
          }}
          handleCurrentViewChange={() => setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_CREATE)}
        />
      ) : (
        <WorkspaceCreateStep
          user={user}
          onComplete={(skipInvites) => handleStepChange(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN, skipInvites)}
          handleCurrentViewChange={() => setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_JOIN)}
          hasInvitations={invitations.length > 0}
        />
      )}
    </>
  );
});

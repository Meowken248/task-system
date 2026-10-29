/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EOnboardingSteps } from "@plane/types";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { WalletTeamSetup } from "@/components/workspace/wallet-team-setup";

type Props = { handleStepChange: (step: EOnboardingSteps, skipInvites?: boolean) => void };
export const InviteTeamStep = observer(function InviteTeamStep({ handleStepChange }: Props) {
  const { workspaces } = useWorkspace();
  const workspace = Object.values(workspaces ?? {})[0];
  return (
    <WalletTeamSetup
      workspaceSlug={workspace?.slug}
      onComplete={() => handleStepChange(EOnboardingSteps.INVITE_MEMBERS)}
    />
  );
});

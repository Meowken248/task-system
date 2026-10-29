/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IUser, IWorkspace } from "@plane/types";
import { WalletTeamSetup } from "@/components/workspace/wallet-team-setup";

type Props = {
  finishOnboarding: () => Promise<void>;
  totalSteps: number;
  user: IUser | undefined;
  workspace: IWorkspace | undefined;
};
export function InviteMembers({ finishOnboarding, workspace }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto">
      <WalletTeamSetup workspaceSlug={workspace?.slug} onComplete={finishOnboarding} />
    </div>
  );
}

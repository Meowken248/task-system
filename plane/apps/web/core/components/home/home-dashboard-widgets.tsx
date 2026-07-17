/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EUserPermissions } from "@plane/constants";
import { useUserPermissions } from "@/hooks/store/user";
import { RecentActivityWidget } from "./widgets";
import { OnChainKpiWidget } from "./on-chain-kpi-widget";

export const HOME_WIDGETS_LIST: Record<string, { title: string }> = {
  quick_links: { title: "home.quick_links.title_plural" },
  recents: { title: "home.recents.title" },
  my_stickies: { title: "stickies.title" },
  new_at_plane: { title: "home.new_at_plane.title" },
  quick_tutorial: { title: "home.quick_tutorial.title" },
};
export const DashboardWidgets = observer(function DashboardWidgets() {
  const { workspaceSlug } = useParams();
  const { getWorkspaceRoleByWorkspaceSlug } = useUserPermissions();
  if (!workspaceSlug) return null;
  const isAdmin = getWorkspaceRoleByWorkspaceSlug(workspaceSlug.toString()) === EUserPermissions.ADMIN;

  return (
    <div className="relative flex h-full w-full flex-col gap-7 py-4">
      <div className="mx-auto w-full max-w-[800px]">
        <RecentActivityWidget workspaceSlug={workspaceSlug.toString()} />
      </div>
      {isAdmin && <OnChainKpiWidget workspaceSlug={workspaceSlug.toString()} />}
    </div>
  );
});

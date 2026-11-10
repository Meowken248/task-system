/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import {
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS_LINKS,
  WORKSPACE_SIDEBAR_STATIC_PINNED_NAVIGATION_ITEMS_LINKS,
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS,
} from "@plane/constants";
import { SidebarItem } from "@/plane-web/components/workspace/sidebar/sidebar-item";

export const SidebarMenuItems = observer(function SidebarMenuItems() {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        {WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS_LINKS.map((item) => (
          <SidebarItem key={item.key} item={item} />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="px-2 py-1.5 text-13 font-semibold text-placeholder">Workspace</div>
        {WORKSPACE_SIDEBAR_STATIC_PINNED_NAVIGATION_ITEMS_LINKS.map((item) => (
          <SidebarItem key={item.key} item={item} />
        ))}
        {WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS.map((item) => (
          <SidebarItem key={item.key} item={item} />
        ))}
      </div>
    </>
  );
});

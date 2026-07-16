/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ContentWrapper } from "@plane/ui";
import { useUser } from "@/hooks/store/user";
import { HomePeekOverviewsRoot } from "@/plane-web/components/home";
import { DashboardWidgets } from "./home-dashboard-widgets";
import { UserGreetingsView } from "./user-greetings";

export const WorkspaceHomeView = observer(function WorkspaceHomeView() {
  const { data: currentUser } = useUser();

  return (
    <>
      <HomePeekOverviewsRoot />
      <ContentWrapper className="mx-auto scrollbar-hide gap-6 bg-surface-1 px-page-x">
        <div className="mx-auto w-full max-w-[800px]">
          {currentUser && <UserGreetingsView user={currentUser} />}
          <DashboardWidgets />
        </div>
      </ContentWrapper>
    </>
  );
});

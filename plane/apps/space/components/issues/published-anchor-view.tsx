/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { PoweredBy } from "@/components/common/powered-by";
import { SomethingWentWrongError } from "@/components/issues/issue-layouts/error";
import { IssuesNavbarRoot } from "@/components/issues/navbar";
import { IssuesLayoutsRoot } from "@/components/issues/issue-layouts";
import { PageNotFound } from "@/components/ui/not-found";
// hooks
import { usePublish, usePublishList } from "@/hooks/store/publish";
import { useIssueFilter } from "@/hooks/store/use-issue-filter";
import { useLabel } from "@/hooks/store/use-label";
import { useStates } from "@/hooks/store/use-state";

export interface PublishedAnchorViewProps {
  anchor: string;
}

export const PublishedAnchorView = observer(function PublishedAnchorView({ anchor }: PublishedAnchorViewProps) {
  const searchParams = useSearchParams();
  const peekId = searchParams.get("peekId") || undefined;

  // store hooks
  const { fetchPublishSettings } = usePublishList();
  const publishSettings = usePublish(anchor);
  const { updateLayoutOptions } = useIssueFilter();
  const { fetchStates } = useStates();
  const { fetchLabels } = useLabel();

  // fetch publish settings
  const { error: settingsError } = useSWR(
    anchor ? `PUBLISH_SETTINGS_${anchor}` : null,
    anchor
      ? async () => {
          const response = await fetchPublishSettings(anchor);
          if (response?.view_props) {
            updateLayoutOptions({
              list: !!response.view_props.list,
              kanban: !!response.view_props.kanban,
              calendar: !!response.view_props.calendar,
              gantt: !!response.view_props.gantt,
              spreadsheet: !!response.view_props.spreadsheet,
            });
          }
        }
      : null
  );

  useSWR(anchor ? `PUBLIC_STATES_${anchor}` : null, anchor ? () => fetchStates(anchor) : null);
  useSWR(anchor ? `PUBLIC_LABELS_${anchor}` : null, anchor ? () => fetchLabels(anchor) : null);

  if (!publishSettings && !settingsError) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface-1">
        <LogoSpinner />
      </div>
    );
  }

  if (settingsError?.status === 404) return <PageNotFound />;
  if (settingsError) return <SomethingWentWrongError />;

  return (
    <>
      <div className="relative flex h-screen min-h-[500px] w-screen flex-col overflow-hidden">
        <div className="relative flex h-[60px] shrink-0 items-center border-b border-subtle-1 bg-surface-1 select-none">
          <IssuesNavbarRoot publishSettings={publishSettings} />
        </div>
        <div className="relative size-full overflow-hidden bg-surface-2">
          <IssuesLayoutsRoot peekId={peekId} publishSettings={publishSettings} />
        </div>
      </div>
      <PoweredBy />
    </>
  );
});


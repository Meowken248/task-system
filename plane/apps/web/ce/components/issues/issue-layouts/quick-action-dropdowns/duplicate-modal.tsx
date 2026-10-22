/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// services
import { IssueService } from "@/services/issue";

type TDuplicateWorkItemModalProps = {
  workItemId: string;
  onClose: () => void;
  isOpen: boolean;
  workspaceSlug: string;
  projectId: string;
};

const DUPLICATED_PROPERTIES = [
  "description_html",
  "priority",
  "state_id",
  "assignee_ids",
  "label_ids",
  "start_date",
  "target_date",
  "estimate_point",
  "type_id",
  "parent_id",
  "cycle_id",
  "module_ids",
] as const;

/**
 * Builds the payload used to duplicate a work item.
 * Identity / bookkeeping fields (id, sequence_id, created_by, timestamps, ...) are
 * intentionally excluded so that the copy is a brand new work item of the project.
 */
export const buildDuplicateWorkItemPayload = (issue: TIssue, name: string): Partial<TIssue> => {
  const payload: Partial<TIssue> = {
    name,
    description_html: issue.description_html ?? "<p></p>",
  };

  DUPLICATED_PROPERTIES.forEach((property) => {
    const value = issue[property as keyof TIssue];
    if (value !== undefined && value !== null) {
      (payload as Record<string, unknown>)[property] = value;
    }
  });

  return payload;
};

export const DuplicateWorkItemModal = observer(function DuplicateWorkItemModal(props: TDuplicateWorkItemModalProps) {
  const { workItemId, isOpen, onClose, workspaceSlug, projectId } = props;
  // store hooks
  const { issues: issuesStore, issueMap } = useIssues();
  const storeType = useIssueStoreType();
  const { getProjectIdentifierById } = useProject();
  // states
  const [name, setName] = useState("");
  const [sourceIssue, setSourceIssue] = useState<TIssue | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load the work item that has to be duplicated (from the store when available,
  // otherwise from the API) and pre-fill the name of the copy.
  useEffect(() => {
    if (!isOpen) return;

    const issueFromStore = issueMap?.[workItemId];
    if (issueFromStore) {
      setSourceIssue(issueFromStore);
      setName(`${issueFromStore.name} (copy)`);
      return;
    }

    let isCancelled = false;
    const issueService = new IssueService();
    issueService
      .retrieve(workspaceSlug, projectId, workItemId)
      .then((fetchedIssue) => {
        if (isCancelled || !fetchedIssue?.id) return false;
        setSourceIssue(fetchedIssue);
        setName(`${fetchedIssue.name} (copy)`);
        return true;
      })
      .catch(() => {
        if (isCancelled) return;
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error",
          message: "Failed to load the work item to duplicate.",
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, issueMap, projectId, workspaceSlug, workItemId]);

  const handleClose = () => {
    if (isSubmitting) return;
    setName("");
    setSourceIssue(undefined);
    onClose();
  };

  const handleDuplicate = async () => {
    const trimmedName = name.trim();
    if (!sourceIssue || !trimmedName || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = buildDuplicateWorkItemPayload(sourceIssue, trimmedName);
      // Cycle / module layouts require the container id so that the copy also shows
      // up in the currently opened view.
      const containerId =
        storeType === EIssuesStoreType.CYCLE
          ? (sourceIssue.cycle_id ?? undefined)
          : storeType === EIssuesStoreType.MODULE
            ? sourceIssue.module_ids?.[0]
            : undefined;

      const createIssue = (issuesStore as { createIssue?: (...args: any[]) => Promise<TIssue> }).createIssue;
      if (typeof createIssue === "function") {
        await createIssue.call(issuesStore, workspaceSlug, projectId, payload, containerId);
      } else {
        const issueService = new IssueService();
        const createdIssue = await issueService.createIssue(workspaceSlug, projectId, payload);
        (issuesStore as { addIssue?: (issue: TIssue) => void }).addIssue?.(createdIssue);
      }

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Work item duplicated successfully",
      });
      setName("");
      setSourceIssue(undefined);
      onClose();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error",
        message: "Failed to duplicate the work item",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const projectIdentifier = sourceIssue ? getProjectIdentifierById(sourceIssue.project_id) : "";
  const sourceIdentifier = projectIdentifier && sourceIssue?.sequence_id ? `${projectIdentifier}-${sourceIssue.sequence_id}` : "";

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div className="px-5 py-4">
        <h3 className="text-18 font-medium 2xl:text-20">Duplicate work item</h3>
        <p className="mt-2 text-13 text-secondary">
          {sourceIdentifier ? (
            <>
              A copy of <span className="font-medium text-primary">{sourceIdentifier}</span> will be created in this
              project with the same properties.
            </>
          ) : (
            "A copy of this work item will be created with the same properties."
          )}
        </p>
        <div className="mt-4">
          <label className="mb-1 block text-12 text-secondary" htmlFor="duplicate-work-item-name">
            Name
          </label>
          <Input
            id="duplicate-work-item-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Work item name"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={handleDuplicate}
            loading={isSubmitting}
            disabled={!name.trim() || !sourceIssue}
          >
            {isSubmitting ? "Duplicating..." : "Duplicate"}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});


/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
// plane internal
import { STATE_GROUPS } from "@plane/constants";
import type { TStateGroups } from "@plane/types";
// helpers
import { getDate } from "@/helpers/date-time.helper";

/**
 * @description get the highlight color class for an issue due date
 * Rules (Note BA):
 * - Hết hạn (target date < today): "text-danger-primary" (Màu đỏ)
 * - Sắp đến hạn (target date == today, trong ngày): "text-warning-primary" (Màu vàng nâu)
 * - Còn hạn (target date > today): "" (Màu đen / mặc định)
 * @param date target_date or end_date
 * @param stateGroup optional state group (e.g. "completed", "cancelled")
 * @returns string CSS class
 */
export const getIssueDueDateHighlightClass = (
  date: string | Date | null | undefined,
  stateGroup?: TStateGroups | undefined
): string => {
  if (!date) return "";

  const parsedDate = getDate(date);
  if (!parsedDate) return "";

  const targetDateDistance = differenceInCalendarDays(parsedDate, new Date());

  // Hết hạn: Màu đỏ (< today)
  if (targetDateDistance < 0) {
    if (stateGroup && [STATE_GROUPS.completed.key, STATE_GROUPS.cancelled.key].includes(stateGroup)) {
      return "";
    }
    return "text-danger-primary";
  }

  // Sắp đến hạn (trong ngày hôm nay): Màu vàng nâu
  if (targetDateDistance === 0) {
    return "text-warning-primary";
  }

  // Còn hạn (> today): Màu đen / mặc định
  return "";
};

/**
 * @description check if the issue due date should be highlighted
 * @param date
 * @param stateGroup
 * @returns boolean
 */
export const shouldHighlightIssueDueDate = (
  date: string | Date | null,
  stateGroup: TStateGroups | undefined
): boolean => {
  return getIssueDueDateHighlightClass(date, stateGroup) !== "";
};

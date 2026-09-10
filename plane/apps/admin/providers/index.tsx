/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { initDAppDB } from "@plane/services";
import { CoreProviders } from "./core";
import { ExtendedProviders } from "./extended";

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initDAppDB().catch(() => {});
  }, []);

  return (
    <CoreProviders>
      <ExtendedProviders>{children}</ExtendedProviders>
    </CoreProviders>
  );
}

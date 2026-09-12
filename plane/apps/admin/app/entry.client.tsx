/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// ── DApp Mode: Safe native form submit fallback ───────────────────────
if (typeof document !== "undefined") {
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    const action = this.action || "";
    if (action.includes("sign-out")) {
      localStorage.removeItem("plane_dapp_auth_user");
      localStorage.removeItem("plane_dapp_auth_email");
      window.location.href = "/god-mode/";
      return;
    }
    originalSubmit.call(this);
  };
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});

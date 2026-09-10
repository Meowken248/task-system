/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
import { PlaneLockup } from "@plane/propel/icons";

type AuthHeaderProps = {
  mode?: "sign-in" | "sign-up";
  onToggleMode?: (mode: "sign-in" | "sign-up") => void;
};

export function AuthHeader({ mode = "sign-in", onToggleMode }: AuthHeaderProps = {}) {
  return (
    <div className="sticky top-0 flex w-full flex-shrink-0 items-center justify-between gap-6">
      <Link href="/">
        <PlaneLockup height={20} width={95} className="text-primary" />
      </Link>
      {onToggleMode && (
        <div className="flex items-center gap-1.5 text-13 font-medium text-tertiary">
          <span>{mode === "sign-up" ? "Already have an account?" : "Need to set up instance?"}</span>
          <button
            type="button"
            onClick={() => onToggleMode(mode === "sign-up" ? "sign-in" : "sign-up")}
            className="text-accent-primary hover:underline font-semibold"
          >
            {mode === "sign-up" ? "Sign in" : "Sign up"}
          </button>
        </div>
      )}
    </div>
  );
}

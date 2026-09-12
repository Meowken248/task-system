/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useLocation, useSearchParams } from "react-router";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { InstanceFailureView } from "@/components/instance/failure";
import { InstanceSetupForm } from "@/components/instance/setup-form";
// hooks
import { useInstance } from "@/hooks/store";
// components
import type { Route } from "./+types/page";
import { InstanceSignInForm } from "./sign-in-form";

function HomePage() {
  // store hooks
  const { instance, error } = useInstance();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const isSignUpPath = location.pathname.includes("/sign-up") || location.pathname.includes("/setup");
  const modeParam = searchParams.get("mode");

  const [mode, setMode] = useState<"sign-in" | "sign-up">(() => {
    if (isSignUpPath || modeParam === "sign-up" || modeParam === "setup") return "sign-up";
    return "sign-in";
  });

  useEffect(() => {
    if (isSignUpPath || modeParam === "sign-up" || modeParam === "setup") {
      setMode("sign-up");
    } else if (modeParam === "sign-in") {
      setMode("sign-in");
    }
  }, [isSignUpPath, modeParam]);

  const handleToggleMode = (newMode: "sign-in" | "sign-up") => {
    setMode(newMode);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newMode === "sign-up") {
        next.set("mode", "sign-up");
      } else {
        next.delete("mode");
      }
      return next;
    });
  };

  // if instance is not fetched, show loading
  if (!instance && !error) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  }

  // if instance fetch fails, show failure view
  if (error) {
    return <InstanceFailureView />;
  }

  // if user explicitly chose sign-in mode, show sign in form
  if (mode === "sign-in") {
    return <InstanceSignInForm onToggleMode={handleToggleMode} />;
  }

  // if instance is fetched and setup is not done, or mode is sign-up, show setup form
  if ((instance && !instance?.is_setup_done) || mode === "sign-up") {
    return <InstanceSetupForm onToggleMode={handleToggleMode} />;
  }

  // if instance is fetched and setup is done, show sign in form
  return <InstanceSignInForm onToggleMode={handleToggleMode} />;
}

export default observer(HomePage);

export const meta: Route.MetaFunction = () => [
  { title: "Admin – Instance Setup & Sign-In" },
  { name: "description", content: "Configure your Plane instance or sign in to the admin portal." },
];

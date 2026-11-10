/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import { EAuthModes, EAuthSteps } from "@plane/constants";
import type { IEmailCheckData } from "@plane/types";
// helpers
import type { TAuthErrorInfo } from "@/helpers/authentication.helper";
import { authErrorHandler, EErrorAlertType, EAuthenticationErrorCodes } from "@/helpers/authentication.helper";
import { getInvitationReturnPath, safeInternalPath } from "@/helpers/invitation-navigation";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { AuthService } from "@/services/auth.service";
// local components
import { AuthEmailForm } from "./email";
import { AuthPasswordForm } from "./password";
import { AuthUniqueCodeForm } from "./unique-code";

type TAuthFormRoot = {
  authStep: EAuthSteps;
  authMode: EAuthModes;
  email: string;
  setEmail: (email: string) => void;
  setAuthMode: (authMode: EAuthModes) => void;
  setAuthStep: (authStep: EAuthSteps) => void;
  setErrorInfo: (errorInfo: TAuthErrorInfo | undefined) => void;
  currentAuthMode: EAuthModes;
};

const authService = new AuthService();

export const AuthFormRoot = observer(function AuthFormRoot(props: TAuthFormRoot) {
  const { authStep, authMode, email, setEmail, setAuthMode, setAuthStep, setErrorInfo, currentAuthMode } = props;
  // router
  const router = useAppRouter();
  // query params
  const searchParams = useSearchParams();
  const nextPath = getInvitationReturnPath(new URLSearchParams(searchParams.toString())) || safeInternalPath(searchParams.get("next_path"));
  // states
  const [isExistingEmail, setIsExistingEmail] = useState(false);
  // hooks
  const { config } = useInstance();

  const isSMTPConfigured = config?.is_smtp_configured || false;

  // submit handler- email verification
  const handleEmailVerification = async (data: IEmailCheckData) => {
    setEmail(data.email);
    setErrorInfo(undefined);
    try {
      const response = await authService.emailCheck(data);
      if (response.existing && currentAuthMode === EAuthModes.SIGN_UP) setAuthMode(EAuthModes.SIGN_IN);
      if (!response.existing && currentAuthMode === EAuthModes.SIGN_IN) setAuthMode(EAuthModes.SIGN_UP);
      if (response.status === "MAGIC_CODE") {
        await generateEmailUniqueCode(data.email);
        setAuthStep(EAuthSteps.UNIQUE_CODE);
      } else if (response.status === "CREDENTIAL") {
        setAuthStep(EAuthSteps.PASSWORD);
      }
      setIsExistingEmail(response.existing);
    } catch (error: any) {
      const errorhandler = authErrorHandler(error?.error_code?.toString(), data?.email || undefined);
      if (errorhandler?.type) setErrorInfo(errorhandler);
    }
  };

  const handleEmailClear = () => {
    setAuthMode(currentAuthMode);
    setErrorInfo(undefined);
    setEmail("");
    setAuthStep(EAuthSteps.EMAIL);
    const authPath = currentAuthMode === EAuthModes.SIGN_IN ? "/" : "/sign-up";
    router.push(`${authPath}${nextPath ? `?next_path=${encodeURIComponent(nextPath)}` : ""}`);
  };

  // generating the unique code
  const generateEmailUniqueCode = async (targetEmail: string): Promise<{ code: string } | undefined> => {
    const payload = { email: targetEmail };
    return await authService
      .generateUniqueCode(payload)
      .then(() => ({ code: "" }))
      .catch((error) => {
        const errorhandler = authErrorHandler(error?.error_code?.toString());
        setErrorInfo(errorhandler?.type ? errorhandler : {
          type: EErrorAlertType.BANNER_ALERT,
          code: EAuthenticationErrorCodes.SMTP_NOT_CONFIGURED,
          title: "Chưa gửi được mã xác nhận",
          message: error?.error || "Chưa gửi được mã xác nhận. Vui lòng thử lại sau.",
        });
        throw error;
      });
  };

  if (authStep === EAuthSteps.EMAIL) {
    return <AuthEmailForm defaultEmail={email} onSubmit={handleEmailVerification} />;
  }
  if (authStep === EAuthSteps.UNIQUE_CODE) {
    return (
      <AuthUniqueCodeForm
        mode={authMode}
        email={email}
        isExistingEmail={isExistingEmail}
        handleEmailClear={handleEmailClear}
        generateEmailUniqueCode={generateEmailUniqueCode}
        nextPath={nextPath || undefined}
        handleAuthStep={(step: EAuthSteps) => setAuthStep(step)}
      />
    );
  }
  if (authStep === EAuthSteps.PASSWORD) {
    return (
      <AuthPasswordForm
        mode={authMode}
        isSMTPConfigured={isSMTPConfigured}
        email={email}
        handleEmailClear={handleEmailClear}
        handleAuthStep={async (step: EAuthSteps) => {
          try {
            if (step === EAuthSteps.UNIQUE_CODE) await generateEmailUniqueCode(email);
            setAuthStep(step);
          } catch {
            // The generation handler displays the delivery error; retain the current form.
          }
        }}
        nextPath={nextPath || undefined}
      />
    );
  }

  return <></>;
});

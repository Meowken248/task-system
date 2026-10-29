/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { Control, FieldArrayWithId, FormState } from "react-hook-form";
import { Controller } from "react-hook-form";
// plane imports
import { ROLE } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CloseIcon } from "@plane/propel/icons";
import { CustomSelect, Input } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import type { InvitationFormValues } from "@/hooks/use-workspace-invitation";

type TInvitationFieldsProps = {
  workspaceSlug: string;
  fields: FieldArrayWithId<InvitationFormValues, "emails", "id">[];
  control: Control<InvitationFormValues>;
  formState: FormState<InvitationFormValues>;
  remove: (index: number) => void;
  className?: string;
};

export const InvitationFields = observer(function InvitationFields(props: TInvitationFieldsProps) {
  const {
    workspaceSlug,
    fields,
    control,
    formState: { errors },
    remove,
    className,
  } = props;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { workspaceInfoBySlug } = useUserPermissions();
  // derived values
  const currentWorkspaceRole = workspaceInfoBySlug(workspaceSlug.toString())?.role;

  return (
    <div className={cn("mb-3 space-y-4", className)}>
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="group relative mb-1 flex w-full items-start justify-between gap-x-4 text-body-xs-regular"
        >
          <div className="w-full">
            <Controller
              control={control}
              name={`emails.${index}.email`}
              rules={{
                required: t("workspace_settings.settings.members.modal.errors.required"),
                pattern: {
                  value: /^([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|0x[a-fA-F0-9]{40})$/i,
                  message: t("workspace_settings.settings.members.modal.errors.invalid"),
                },
              }}
              render={({ field: { value, onChange, ref } }) => (
                <>
                  <Input
                    id={`emails.${index}.email`}
                    name={`emails.${index}.email`}
                    type="text"
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    hasError={Boolean(errors.emails?.[index]?.email)}
                    placeholder="email@example.com / 0x..."
                    className="w-full text-caption-sm-regular sm:text-body-xs-regular"
                  />
                  {errors.emails?.[index]?.email && (
                    <span className="ml-1 text-caption-sm-regular text-danger-primary">
                      {errors.emails?.[index]?.email?.message}
                    </span>
                  )}
                </>
              )}
            />
            <Controller
              control={control}
              name={`emails.${index}.wallet_address`}
              rules={{
                validate: (value) =>
                  !value ||
                  (/^0x[a-f0-9]{40}$/i.test(value.trim()) && !/^0x0{40}$/i.test(value.trim())) ||
                  "Địa chỉ ví không hợp lệ.",
              }}
              render={({ field: walletField }) => (
                <div className="mt-2">
                  <Input
                    {...walletField}
                    value={walletField.value || ""}
                    placeholder="Ví người nhận: 0x... (nếu đã biết)"
                    className="w-full"
                    hasError={Boolean(errors.emails?.[index]?.wallet_address)}
                  />
                  <p className="mt-1 text-caption-sm-regular text-secondary">
                    Cần xác nhận ví người nhận trước khi cấp quyền tham gia.
                  </p>
                  {errors.emails?.[index]?.wallet_address && (
                    <p className="text-caption-sm-regular text-danger-primary">
                      {errors.emails[index]?.wallet_address?.message}
                    </p>
                  )}
                </div>
              )}
            />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <Controller
                control={control}
                name={`emails.${index}.role`}
                rules={{ required: true }}
                render={({ field: { value, onChange } }) => (
                  <CustomSelect
                    value={value}
                    label={<span className="text-caption-sm-regular sm:text-body-xs-regular">{ROLE[value]}</span>}
                    onChange={onChange}
                    className="w-24 flex-grow"
                    input
                  >
                    {Object.entries(ROLE)
                      .filter(([key]) => [15, 20].includes(Number(key)))
                      .map(([key, value]) => {
                        if (currentWorkspaceRole && currentWorkspaceRole >= parseInt(key))
                          return (
                            <CustomSelect.Option key={key} value={parseInt(key)}>
                              {value}
                            </CustomSelect.Option>
                          );
                      })}
                  </CustomSelect>
                )}
              />
            </div>
            {fields.length > 1 && (
              <div className="flex-item flex w-6">
                <button
                  type="button"
                  className="place-items-center self-center rounded-sm"
                  onClick={() => remove(index)}
                >
                  <CloseIcon className="h-4 w-4 text-secondary" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
});

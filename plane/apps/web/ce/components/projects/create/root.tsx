/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { FormProvider, useForm } from "react-hook-form";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EFileAssetType } from "@plane/types";
// components
import ProjectCommonAttributes from "@/components/project/create/common-attributes";
import ProjectCreateHeader from "@/components/project/create/header";
import ProjectCreateButtons from "@/components/project/create/project-create-buttons";
// hooks
import { getCoverImageType, uploadCoverImage } from "@/helpers/cover-image.helper";
import { useProject } from "@/hooks/store/use-project";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web types
import type { TProject } from "@/plane-web/types/projects";
import { ProjectAttributes } from "./attributes";
import { getProjectFormValues } from "./utils";
import { createProjectWithCover } from "./create-with-cover";

export type TCreateProjectFormProps = {
  setToFavorite?: boolean;
  workspaceSlug: string;
  onClose: () => void;
  handleNextStep: (projectId: string) => void;
  data?: Partial<TProject>;
  templateId?: string;
  updateCoverImageStatus: (projectId: string, coverImage: string) => Promise<void>;
};

export const CreateProjectForm = observer(function CreateProjectForm(props: TCreateProjectFormProps) {
  const { setToFavorite, workspaceSlug, data, onClose, handleNextStep, updateCoverImageStatus } = props;
  // store
  const { t } = useTranslation();
  const { addProjectToFavorites, createProject, updateProject } = useProject();
  // states
  const [shouldAutoSyncIdentifier, setShouldAutoSyncIdentifier] = useState(true);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const submitting = useRef(false);
  // form info
  const methods = useForm<TProject>({
    defaultValues: { ...getProjectFormValues(), ...data },
    reValidateMode: "onChange",
  });
  const { handleSubmit, reset, setValue } = methods;
  useEffect(() => {
    if (!coverFile) return;
    const preview = URL.createObjectURL(coverFile);
    setValue("cover_image_url", preview, { shouldDirty: true });
    return () => URL.revokeObjectURL(preview);
  }, [coverFile, setValue]);
  const { isMobile } = usePlatformOS();
  const handleAddToFavorites = (projectId: string) => {
    if (!workspaceSlug) return;

    addProjectToFavorites(workspaceSlug.toString(), projectId).catch(() => {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("failed_to_remove_project_from_favorites"),
      });
    });
  };

  const onSubmit = async (formData: Partial<TProject>) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const result = await createProjectWithCover(formData, coverFile, {
        create: (fields) => createProject(workspaceSlug, fields),
        uploadCover: (source, projectId) => {
          if (typeof source === "string" && getCoverImageType(source) === "uploaded_asset") {
            return Promise.resolve(source);
          }
          return uploadCoverImage(source, {
            workspaceSlug,
            entityIdentifier: projectId,
            entityType: EFileAssetType.PROJECT_COVER,
            isUserAsset: false,
          });
        },
        saveCover: async (projectId, url) => {
          await updateCoverImageStatus(projectId, url);
          await updateProject(workspaceSlug, projectId, { cover_image_url: url });
        },
      });
      if (result.coverFailed) {
        console.warn("Project created but its cover could not be saved:", result.coverError);
        setToast({
          type: TOAST_TYPE.WARNING,
          title: t("project_created_successfully"),
          message: "Ảnh bìa chưa lưu được. Bạn có thể tải lại ảnh trong phần cài đặt dự án.",
        });
      } else {
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("success"), message: t("project_created_successfully") });
      }
      if (setToFavorite) handleAddToFavorites(result.project.id);
      handleNextStep(result.project.id);
    } catch (err: any) {
      try {
        // Handle the new error format where codes are nested in arrays under field names
        const errorData = err?.data ?? {};

        const nameError = errorData.name?.includes("PROJECT_NAME_ALREADY_EXIST");
        const identifierError = errorData?.identifier?.includes("PROJECT_IDENTIFIER_ALREADY_EXIST");

        if (nameError || identifierError) {
          if (nameError) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: t("toast.error"),
              message: t("project_name_already_taken"),
            });
          }

          if (identifierError) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: t("toast.error"),
              message: t("project_identifier_already_taken"),
            });
          }
        } else {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("something_went_wrong"),
          });
        }
      } catch (error) {
        // Fallback error handling if the error processing fails
        console.error("Error processing API error:", error);
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: t("something_went_wrong"),
        });
      }
    } finally {
      submitting.current = false;
    }
  };

  const handleClose = () => {
    onClose();
    setCoverFile(null);
    setShouldAutoSyncIdentifier(true);
    setTimeout(() => {
      reset();
    }, 300);
  };

  return (
    <FormProvider {...methods}>
      <ProjectCreateHeader
        handleClose={handleClose}
        isMobile={isMobile}
        onCoverFileSelect={setCoverFile}
        onCoverChange={() => setCoverFile(null)}
      />

      <form onSubmit={handleSubmit(onSubmit)} className="px-3">
        <div className="mt-9 space-y-6 pb-5">
          <ProjectCommonAttributes
            setValue={setValue}
            isMobile={isMobile}
            shouldAutoSyncIdentifier={shouldAutoSyncIdentifier}
            setShouldAutoSyncIdentifier={setShouldAutoSyncIdentifier}
          />
          <ProjectAttributes isMobile={isMobile} />
        </div>
        <ProjectCreateButtons handleClose={handleClose} />
      </form>
    </FormProvider>
  );
});

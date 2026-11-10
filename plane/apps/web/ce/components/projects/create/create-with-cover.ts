import type { TProject } from "@/plane-web/types/projects";

type Services = {
  create: (data: Partial<TProject>) => Promise<TProject>;
  uploadCover: (source: string | File, projectId: string) => Promise<string>;
  saveCover: (projectId: string, url: string) => Promise<unknown>;
};

/** Project assets must only be uploaded after their owning project exists. */
export async function createProjectWithCover(
  data: Partial<TProject>,
  file: File | null,
  services: Services
): Promise<{ project: TProject; coverFailed: boolean; coverError?: unknown }> {
  const { cover_image_url, cover_image, cover_image_asset: _asset, ...fields } = data;
  const source = file ?? cover_image_url ?? cover_image;
  if (typeof source === "string" && /^(blob:|data:)/i.test(source)) {
    throw new Error("Please select the cover image again before creating the project.");
  }

  // Never persist a temporary preview URL or an asset belonging to another project.
  const project = await services.create({ ...fields, identifier: fields.identifier?.toUpperCase() });
  if (!source) return { project, coverFailed: false };

  try {
    const url = await services.uploadCover(source, project.id);
    await services.saveCover(project.id, url);
    return { project, coverFailed: false };
  } catch (coverError) {
    // Creation already succeeded. Let the UI continue to this project rather than
    // report a creation failure and encourage a duplicate submission.
    return { project, coverFailed: true, coverError };
  }
}

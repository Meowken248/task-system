/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig, AxiosProgressEvent } from "axios";
// api service
import { APIService } from "../api.service";
import { saveAttachment } from "./attachment-storage";

/**
 * Converts a File object to a Base64 string (without the data URL prefix)
 * Universal support for both modern browsers and Node environments
 */
async function fileToBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === "function") {
    const rawBuffer = await file.arrayBuffer();
    const nodeBuffer = (globalThis as any).Buffer;
    if (typeof nodeBuffer !== "undefined") {
      return nodeBuffer.from(rawBuffer).toString("base64");
    }
    const bytes = new Uint8Array(rawBuffer);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      return reject(new Error("FileReader is not available"));
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.addEventListener("load", () => {
      let encoded = reader.result?.toString() || "";
      const commaIdx = encoded.indexOf(",");
      if (commaIdx !== -1) {
        encoded = encoded.substring(commaIdx + 1);
      }
      resolve(encoded);
    });
    reader.addEventListener("error", (error) => reject(error));
  });
}

/**
 * Computes deterministic SHA-256 hash using the Web Crypto API
 */
async function computeSha256(file: File): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      console.warn("[Metanode] Web Crypto digest failed, using fallback:", e);
    }
  }
  return `${file.name.replace(/[^a-zA-Z0-9]/g, "_")}-${file.size}-${file.lastModified}`;
}

/**
 * Local-first uploads shared by editor images, covers and attachments.
 *
 * @extends {APIService}
 */
export class FileUploadService extends APIService {
  private operations = new Set<{ cancelled: boolean }>();

  constructor() {
    super("");
  }

  /**
   * Saves file bytes locally before callers confirm asset metadata.
   * @param {string} _url - Ignored in DApp mode
   * @param {FormData} data - The form data to upload
   * @returns {Promise<any>} Promise resolving to upload result with asset hash
   * @throws {Error} If the request fails
   */
  async uploadFile(_url: string, data: FormData, onProgress?: AxiosRequestConfig["onUploadProgress"]): Promise<any> {
    if (typeof window === "undefined") throw new Error("Upload cần được thực hiện trên trình duyệt.");

    // 1. Extract file from FormData
    const file = (data.get("asset") || data.get("file")) as File;
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      throw new Error("No file found in FormData under 'asset' or 'file' key");
    }
    const operation = { cancelled: false };
    this.operations.add(operation);
    const checkCancelled = () => {
      if (operation.cancelled) throw new Error("Đã hủy upload tệp.");
    };
    const progress = (value: number) =>
      onProgress?.({
        loaded: Math.floor(file.size * value),
        total: file.size,
        progress: value,
        bytes: 0,
        lengthComputable: true,
      } as AxiosProgressEvent);
    try {
      progress(0);
      const [base64Data, hash] = await Promise.all([fileToBase64(file), computeSha256(file)]);
      checkCancelled();
      progress(0.5);
      const mimeType = file.type || "application/octet-stream";
      const dataUrl = `data:${mimeType};base64,${base64Data}`;
      const providedAssetId = (data.get("asset_id") || data.get("id") || data.get("key")) as string | null;
      const assetId = providedAssetId || hash;

      // Persist under the same ID that the editor stores in its document.
      await saveAttachment(assetId, {
        name: file.name,
        base64: base64Data,
        type: mimeType,
        size: file.size,
      });
      checkCancelled();
      progress(1);
      return {
        asset: assetId,
        asset_id: assetId,
        id: assetId,
        asset_url: dataUrl,
        file_url: dataUrl,
        base64: base64Data,
        file_type: mimeType,
        attributes: {
          name: file.name,
          size: file.size,
        },
      };
    } catch (error: any) {
      console.error("[Metanode] File Upload Error:", error);
      throw error;
    } finally {
      this.operations.delete(operation);
    }
  }

  /**
   * Cancels the upload
   */
  cancelUpload() {
    for (const operation of this.operations) operation.cancelled = true;
  }
}

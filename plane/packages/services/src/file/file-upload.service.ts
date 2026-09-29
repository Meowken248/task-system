/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios from "axios";
// api service
import { APIService } from "../api.service";

/**
 * Converts a File object to a Base64 string (without the data URL prefix)
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      let encoded = reader.result?.toString() || "";
      const commaIdx = encoded.indexOf(",");
      if (commaIdx !== -1) {
        encoded = encoded.substring(commaIdx + 1);
      }
      resolve(encoded);
    };
    reader.onerror = (error) => reject(error);
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
 * Service class for handling file upload operations via File Processor and Metanode FiaiSDK
 *
 * @extends {APIService}
 */
export class FileUploadService extends APIService {
  private cancelSource: any;

  constructor() {
    super("");
  }

  /**
   * Uploads a file using File Processor / FiaiSDK with safe fallback
   * @param {string} _url - Ignored in DApp mode
   * @param {FormData} data - The form data to upload
   * @returns {Promise<any>} Promise resolving to upload result with asset hash
   * @throws {Error} If the request fails
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadFile(_url: string, data: FormData): Promise<any> {
    if (typeof window === "undefined") return;
    this.cancelSource = axios.CancelToken.source();

    // 1. Extract file from FormData
    const file = (data.get("asset") || data.get("file")) as File;
    if (!file) {
      throw new Error("No file found in FormData under 'asset' or 'file' key");
    }

    try {
      const [base64Data, hash] = await Promise.all([
        fileToBase64(file),
        computeSha256(file),
      ]);
      const ext = file.name.split(".").pop() || "";

      console.log(`[Metanode] Processing file: ${file.name} (SHA-256: ${hash})`);

      // 2. Upload to File Processor via FiaiSDK if available
      let uploadResult: any = null;
      const sdk = (window as any).fiaiSDK;
      if (sdk) {
        try {
          const status = sdk.getStatus?.() || {};
          if (status["file-processor"] !== "ready" && sdk.hostBridge?.waitForReady) {
            console.log("[Metanode] Waiting for file-processor frame to be ready...");
            await Promise.race([
              sdk.hostBridge.waitForReady("file-processor", 10000),
              new Promise((res) => setTimeout(res, 3000)),
            ]);
          }
        } catch {
          // ignore status read errors
        }

        if (typeof sdk.request === "function") {
          try {
            console.log("[Metanode] Uploading file to File Processor via FiaiSDK:", file.name);
            uploadResult = await Promise.race([
              sdk.request("uploadFile", {
                filename: file.name,
                ext: ext,
                base64: base64Data,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("File processor upload timeout after 15s")), 15000)
              ),
            ]);
            console.log("[Metanode] File processor upload completed:", uploadResult);
          } catch (uploadErr) {
            console.warn(
              "[Metanode] File processor upload failed/timeout; proceeding with local storage & on-chain hash:",
              uploadErr
            );
          }
        }
      }

      const assetId = hash;
      const dataUrl = `data:${file.type || "application/octet-stream"};base64,${base64Data}`;

      return {
        asset: assetId,
        id: assetId,
        asset_url: dataUrl,
        base64: base64Data,
        file_type: file.type || "application/octet-stream",
        file_path: uploadResult?.path || (typeof uploadResult === "string" ? uploadResult : undefined),
        attributes: {
          name: file.name,
          size: file.size,
        },
      };
    } catch (error: any) {
      console.error("[Metanode] File Upload Error:", error);
      throw error;
    }
  }

  /**
   * Cancels the upload
   */
  cancelUpload() {
    if (this.cancelSource) {
      this.cancelSource.cancel("Upload canceled");
    }
  }
}


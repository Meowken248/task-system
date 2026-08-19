/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios from "axios";
// api service
import { APIService } from "../api.service";

/**
 * Converts a File object to a Base64 string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      let encoded = reader.result?.toString() || "";
      // SystemCore APIs usually expect pure base64 without the data URL prefix
      const commaIdx = encoded.indexOf(",");
      if (commaIdx !== -1) {
        encoded = encoded.substring(commaIdx + 1);
      }
      resolve(encoded);
    };
    reader.onerror = error => reject(error);
  });
}

/**
 * Service class for handling file upload operations via Metanode SDK
 * @extends {APIService}
 */
export class FileUploadService extends APIService {
  private cancelSource: any;

  constructor() {
    super("");
  }

  /**
   * Uploads a file using @metanodejs/system-core
   * @param {string} url - Ignored in DApp mode
   * @param {FormData} data - The form data to upload
   * @returns {Promise<any>} Promise resolving to upload result (usually a Hash or URL)
   * @throws {Error} If the request fails
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadFile(_url: string, data: FormData): Promise<any> {
    if (typeof window === "undefined") return;
    this.cancelSource = axios.CancelToken.source();

    try {
      // 1. Extract file from FormData
      const file = data.get("asset") as File;
      if (!file) {
        throw new Error("No file found in FormData under 'asset' key");
      }

      console.log("[Metanode] Uploading file:", file.name);

      // 2. Convert File to Base64
      const base64Data = await fileToBase64(file);

      // 3. Upload via Metanode SDK
      const { createFileWithBase64 } = await import("@metanodejs/system-core");
      const ext = file.name.split('.').pop() || '';
      const result = await createFileWithBase64({ 
        base64: base64Data, 
        name: file.name, 
        ext: ext 
      });

      console.log("[Metanode] Upload success:", result);
      
      // MOCK Plane's expected response format:
      // Typically returns { asset: "https://url.to/file" }
      return { 
        asset: result, // Assuming result is the hash/url
        id: Math.random().toString(36).substr(2, 9),
        attributes: {
          name: file.name,
          size: file.size,
        }
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

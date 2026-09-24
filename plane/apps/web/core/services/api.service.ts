/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import axios from "axios";
import { setupDAppInterceptor } from "@plane/services";

export abstract class APIService {
  // Shared by all service instances to prevent parallel 401 responses from
  // causing a full-page redirect loop.
  private static authRedirectInProgress = false;
  protected baseURL: string;
  private axiosInstance: AxiosInstance;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = axios.create({
      baseURL,
      withCredentials: true,
    });

    this.setupInterceptors();
    setupDAppInterceptor(this.axiosInstance);
  }

  private setupInterceptors() {
    this.axiosInstance.interceptors.response.use(
      (response) => {
        APIService.authRedirectInProgress = false;
        return response;
      },
      (error) => {
        if (typeof window !== "undefined" && error.response?.status === 401) {
          const routerBase = (typeof process !== "undefined" && process.env?.VITE_ROUTER_BASENAME) || "/plane";
          const cleanBase = routerBase === "/" ? "" : routerBase.replace(/\/+$/, "");
          const appRoot = cleanBase ? `${cleanBase}/` : "/";

          const currentPathname = window.location.pathname.replace(/\/+$/, "") || "/";
          const rootNormalized = cleanBase || "/";

          // If the user is already on the sign-in / landing page or auth pages, DO NOT redirect!
          const isAtAppRoot = currentPathname === rootNormalized;
          const isAuthPage =
            isAtAppRoot ||
            currentPathname.endsWith("/sign-up") ||
            currentPathname.includes("/accounts/");

          if (!isAuthPage && !APIService.authRedirectInProgress) {
            APIService.authRedirectInProgress = true;
            const currentPath = `${window.location.pathname}${window.location.search}`;
            window.location.replace(`${appRoot}?next_path=${encodeURIComponent(currentPath)}`);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}

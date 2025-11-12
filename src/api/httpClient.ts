import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import SessionStore from '@/stores/sessionStore';
import { getContextType } from '@/utils/storageSync';
import { debugLog } from '@/utils/debug';

const DEFAULT_TIMEOUT = 120000;

const baseConfig: AxiosRequestConfig = {
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: DEFAULT_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
};

const context = getContextType();

const attachInterceptors = (instance: AxiosInstance): AxiosInstance => {
  instance.interceptors.request.use(config => {
    const headers = config.headers as Record<string, any> | undefined;
    const allowWhenLocked = headers?.['x-allow-locked'];
    if (allowWhenLocked) {
      delete headers['x-allow-locked'];
      if (context === 'background') {
        // SECURITY: Only background processes (service worker) are allowed to bypass the lock.
        // This enables critical background operations (idle sync, tip updates) to continue
        // even when the UI is locked, ensuring dApps remain functional.
        //
        // UI contexts (popup, options) must NEVER set this header to prevent:
        // 1. Leaking sensitive requests while the session is closed
        // 2. Race conditions where UI fires requests before lock state propagates
        // 3. Potential DDoS attacks by malicious websites injecting requests
        //
        // If a UI context attempts to use this header, the request is rejected.
        return config;
      }
      const error = new AxiosError('SESSION_LOCKED', AxiosError.ERR_CANCELED);
      return Promise.reject(error);
    }

    if (!SessionStore.state.isUnlocked) {
      debugLog('HTTP request blocked - session locked', { url: config.url, method: config.method });
      const error = new AxiosError('SESSION_LOCKED', AxiosError.ERR_CANCELED);
      return Promise.reject(error);
    }

    return config;
  });

  return instance;
};

export const createHttpClient = (config: AxiosRequestConfig = {}): AxiosInstance => {
  const instance = axios.create({
    ...baseConfig,
    ...config,
    headers: {
      ...baseConfig.headers,
      ...(config.headers || {}),
    },
  });

  return attachInterceptors(instance);
};

export const httpClient = createHttpClient();


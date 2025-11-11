import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import SessionStore from '@/stores/sessionStore';
import { getContextType } from '@/utils/storageSync';

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
        return config;
      }
      const error = new AxiosError('SESSION_LOCKED', AxiosError.ERR_CANCELED);
      return Promise.reject(error);
    }

    if (!SessionStore.state.isUnlocked) {
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


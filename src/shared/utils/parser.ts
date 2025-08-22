import axios from 'axios';

export const parseHttpError = error => {
  if (axios.isAxiosError(error)) {
    // Check for specific error types
    if (error.code === 'ECONNABORTED') {
      return 'Request timeout - please try again';
    }
    
    if (error.message === 'canceled' || error.message.includes('cancel')) {
      return 'Request was canceled';
    }
    
    if (error.response) {
      // Server responded with error status
      return JSON.stringify({
        data: error.response.data,
        headers: error.response.headers,
        status: error.response.status,
      });
    } else if (error.request) {
      // Request was made but no response received (timeout, network error, etc.)
      return `Network error: ${error.message || 'No response received'}`;
    } else {
      // Something else happened
      return error.message;
    }
  } else {
    return JSON.stringify(error);
  }
};

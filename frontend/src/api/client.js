import axios from 'axios';
import { mockStore } from './mockStore';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 4000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isBackendAvailable = null; // null: unknown, true: working, false: offline fallback

async function checkBackend() {
  if (isBackendAvailable !== null) return isBackendAvailable;
  try {
    await apiClient.get('/children', { timeout: 1500 });
    isBackendAvailable = true;
  } catch (err) {
    // If connection refused or 404/500 on dev, mark false
    if (!err.response || err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK') {
      isBackendAvailable = false;
      console.info('[API] Backend offline or unreachable. Using integrated local store.');
    } else {
      isBackendAvailable = true;
    }
  }
  return isBackendAvailable;
}

export const api = {
  // Auth
  async loginChild({ child_id, pin }) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post('/auth/child-login', { child_id, pin });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.childLogin(child_id, pin);
        throw (err.response?.data?.error || err.response?.data?.message || '登录失败');
      }
    }
    const res = mockStore.childLogin(child_id, pin);
    if (!res.success) throw res.error;
    return res;
  },

  async loginParent({ pin }) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post('/auth/parent-login', { pin });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.parentLogin(pin);
        throw (err.response?.data?.error || err.response?.data?.message || 'PIN 码错误');
      }
    }
    const res = mockStore.parentLogin(pin);
    if (!res.success) throw res.error;
    return res;
  },

  // Children
  async getChildren() {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get('/children');
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getChildren();
        throw err;
      }
    }
    return mockStore.getChildren();
  },

  async createChild(data) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post('/children', data);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.createChild(data);
        throw err;
      }
    }
    return mockStore.createChild(data);
  },

  async updateChild(id, data) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.put(`/children/${id}`, data);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.updateChild(id, data);
        throw err;
      }
    }
    return mockStore.updateChild(id, data);
  },

  async deleteChild(id) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.delete(`/children/${id}`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.deleteChild(id);
        throw err;
      }
    }
    return mockStore.deleteChild(id);
  },

  // Templates
  async getTaskTemplates() {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get('/task-templates');
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getTemplates();
        throw err;
      }
    }
    return mockStore.getTemplates();
  },

  async createTaskTemplate(data) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post('/task-templates', data);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.createTemplate(data);
        throw err;
      }
    }
    return mockStore.createTemplate(data);
  },

  async updateTaskTemplate(id, data) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.put(`/task-templates/${id}`, data);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.updateTemplate(id, data);
        throw err;
      }
    }
    return mockStore.updateTemplate(id, data);
  },

  async deleteTaskTemplate(id) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.delete(`/task-templates/${id}`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.deleteTemplate(id);
        throw err;
      }
    }
    return mockStore.deleteTemplate(id);
  },

  // Daily Tasks
  async getDailyTasks(childId, date) {
    if (await checkBackend()) {
      try {
        const params = { child_id: childId };
        if (date) params.date = date;
        const res = await apiClient.get('/daily-tasks', { params });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getDailyTasks(childId, date);
        throw err;
      }
    }
    return mockStore.getDailyTasks(childId, date);
  },

  async completeDailyTask(taskId) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post(`/daily-tasks/${taskId}/complete`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.completeTask(taskId);
        throw err;
      }
    }
    return mockStore.completeTask(taskId);
  },

  async uncompleteDailyTask(taskId) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post(`/daily-tasks/${taskId}/uncomplete`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.uncompleteTask(taskId);
        throw err;
      }
    }
    return mockStore.uncompleteTask(taskId);
  },

  // Stats & Badges
  async getChildStats(childId) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get(`/children/${childId}/stats`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getChildStats(childId);
        throw err;
      }
    }
    return mockStore.getChildStats(childId);
  },

  async getChildBadges(childId) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get(`/children/${childId}/badges`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getChildBadges(childId);
        throw err;
      }
    }
    return mockStore.getChildBadges(childId);
  },

  async getBadgeDefinitions() {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get('/badge-definitions');
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getBadgeDefinitions();
        throw err;
      }
    }
    return mockStore.getBadgeDefinitions();
  },

  async getHistory(childId, days = 7) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get(`/children/${childId}/history`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getHistory(childId, days);
        throw err;
      }
    }
    return mockStore.getHistory(childId, days);
  },

  async getWeeklySummary(childId) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.get(`/children/${childId}/weekly-summary`);
        return res.data;
      } catch (err) {
        return null;
      }
    }
    return null;
  },

  async getPointLogs(childId) {
    return mockStore.getPointLogs(childId);
  },

  // Mistakes
  async getMistakes(childId, subject) {
    if (await checkBackend()) {
      try {
        const params = {};
        if (childId) params.child_id = childId;
        if (subject && subject !== '全部') params.subject = subject;
        const res = await apiClient.get('/mistakes', { params });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getMistakes(childId, subject);
        throw err;
      }
    }
    return mockStore.getMistakes(childId, subject);
  },

  async createMistake(data) {
    let payload = data;
    let fallbackPhotoPath = null;
    let childId = data?.child_id;
    let subject = data?.subject;
    let description = data?.description;

    if (typeof FormData !== 'undefined' && data instanceof FormData) {
      payload = data;
      childId = data.get('child_id');
      subject = data.get('subject');
      description = data.get('description');
      fallbackPhotoPath = data.get('photo_data_url') || null;
    } else if (data?.photo_file || data?.photoFile) {
      const file = data.photo_file || data.photoFile;
      payload = new FormData();
      payload.append('child_id', childId);
      payload.append('subject', subject);
      payload.append('description', description);
      payload.append('file', file, file.name || 'mistake.webp');
      fallbackPhotoPath = data.photo_data_url || data.photo_path || null;
      if (fallbackPhotoPath) {
        payload.append('photo_data_url', fallbackPhotoPath);
      }
    } else {
      fallbackPhotoPath = data?.photo_path || null;
    }

    const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;

    if (await checkBackend()) {
      try {
        const config = isFormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {};
        const res = await apiClient.post('/mistakes', payload, config);
        return res.data;
      } catch (err) {
        if (!err.response) {
          return mockStore.createMistake({
            child_id: childId,
            subject,
            description,
            photo_path: fallbackPhotoPath
          });
        }
        throw err;
      }
    }

    return mockStore.createMistake({
      child_id: childId,
      subject,
      description,
      photo_path: fallbackPhotoPath
    });
  },

  async markMistakeMastered(id, isMastered = true) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.put(`/mistakes/${id}/master`, { is_mastered: isMastered });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.markMistakeMastered(id, isMastered);
        throw err;
      }
    }
    return mockStore.markMistakeMastered(id, isMastered);
  },

  async deleteMistake(id) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.delete(`/mistakes/${id}`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.deleteMistake(id);
        throw err;
      }
    }
    return mockStore.deleteMistake(id);
  },

  // Characters (生字本)
  async getCharacters(childId, isMastered = null) {
    if (await checkBackend()) {
      try {
        const params = {};
        if (childId) params.child_id = childId;
        if (isMastered !== null && isMastered !== undefined) {
          params.is_mastered = isMastered === 1 || isMastered === true || isMastered === '1' ? 1 : 0;
        }
        const res = await apiClient.get('/characters', { params });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.getCharacters(childId, isMastered);
        throw err;
      }
    }
    return mockStore.getCharacters(childId, isMastered);
  },

  async createCharacter(data) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.post('/characters', data);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.createCharacter(data);
        throw (err.response?.data?.error || err.response?.data?.message || '添加生字失败');
      }
    }
    return mockStore.createCharacter(data);
  },

  async markCharacterMastered(id, isMastered = null) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.put(`/characters/${id}/master`, { is_mastered: isMastered });
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.markCharacterMastered(id, isMastered);
        throw err;
      }
    }
    return mockStore.markCharacterMastered(id, isMastered);
  },

  async deleteCharacter(id) {
    if (await checkBackend()) {
      try {
        const res = await apiClient.delete(`/characters/${id}`);
        return res.data;
      } catch (err) {
        if (!err.response) return mockStore.deleteCharacter(id);
        throw err;
      }
    }
    return mockStore.deleteCharacter(id);
  }
};

export default api;


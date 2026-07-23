import { useCallback, useEffect, useState } from 'react';

import { apiUrl, readJsonResponse } from '@/lib/api-client';
import { fallbackLibrary, Library } from '@/lib/book';

type LibraryState = {
  library: Library;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};

export function useLibrary(): LibraryState {
  const [library, setLibrary] = useState<Library>(fallbackLibrary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(apiUrl('/api/library'));
      const latest = await readJsonResponse<Library>(response);
      if (!Array.isArray(latest.books)) throw new Error('书库格式无效');
      setLibrary(latest);
    } catch (loadError) {
      setLibrary(fallbackLibrary);
      setError(loadError instanceof Error ? loadError.message : '读取书库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { library, loading, error, reload };
}

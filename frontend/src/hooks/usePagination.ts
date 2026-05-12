import { useState, useCallback } from 'react';

interface UsePaginationOptions {
  initialLimit?:  number;
  initialOffset?: number;
}

export function usePagination({
  initialLimit  = 20,
  initialOffset = 0,
}: UsePaginationOptions = {}) {
  const [offset, setOffset] = useState(initialOffset);
  const [limit]             = useState(initialLimit);

  const loadMore = useCallback(() => {
    setOffset((prev) => prev + limit);
  }, [limit]);

  const reset = useCallback(() => {
    setOffset(0);
  }, []);

  const page = Math.floor(offset / limit);

  return { offset, limit, loadMore, reset, page };
}

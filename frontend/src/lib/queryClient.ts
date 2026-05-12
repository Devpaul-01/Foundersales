import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:           60_000,      // 1 minute default
      gcTime:              5 * 60_000,  // 5 minutes garbage collection
      retry:               (failureCount, error) => {
        // Never retry 4xx client errors
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        // Retry 5xx once
        if (status && status >= 500 && failureCount < 1) return true;
        // Retry network errors once
        return failureCount < 1;
      },
      retryDelay:          1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect:   true,
      refetchOnMount:       true,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Prefetch a query into the cache */
export async function prefetchQuery<T>(
  queryKey: readonly unknown[],
  queryFn:  () => Promise<T>,
  options?: { staleTime?: number },
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey,
    queryFn,
    staleTime: options?.staleTime ?? 60_000,
  });
}

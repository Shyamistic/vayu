import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client for the VAYU application.
 *
 * Configured with sensible defaults:
 * - staleTime: 5 minutes (data considered fresh for this duration)
 * - gcTime: 30 minutes (unused cache entries kept for this duration)
 * - retry: 2 attempts on failure
 * - refetchOnWindowFocus: false (avoid unnecessary refetches for climate data)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

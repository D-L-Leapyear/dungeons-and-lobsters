'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function LiveRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs, router]);
  return null;
}

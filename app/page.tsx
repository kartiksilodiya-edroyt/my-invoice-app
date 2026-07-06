'use client';

import { useEffect, useRef } from 'react';
import './invoice-app.css';
import { APP_MARKUP } from './invoice-app-markup';

export default function Page() {
  const initedRef = useRef(false);      

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    // Dynamically imported so nothing inside invoice-app.ts (which touches
    // document/window/crypto at module scope in a few helpers) ever runs
    // during server-side rendering.
    import('./invoice-app').then((mod) => mod.initApp());
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: APP_MARKUP }} />;
}
'use client';

import { useEffect, useState } from 'react';

const PROGRESS_MESSAGES = [
  'Resolving your location...',
  'Classifying the issue...',
  'Checking location history...',
  'Drafting 311 submission...',
  'Finalizing report...',
];

export function AgentProgressBar({ active }: { active: boolean }) {
  const [message, setMessage] = useState(PROGRESS_MESSAGES[0]);

  useEffect(() => {
    if (!active) return;

    let i = 0;
    setMessage(PROGRESS_MESSAGES[0]);
    const interval = setInterval(() => {
      i++;
      if (i < PROGRESS_MESSAGES.length) {
        setMessage(PROGRESS_MESSAGES[i]);
      }
    }, 7000);

    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '13px', color: '#999', marginBottom: '8px' }}>{message}</div>
      <div style={{ height: '2px', background: '#F0F0F0', borderRadius: '2px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            background: '#FF4500',
            borderRadius: '2px',
            animation: 'agent-progress 35s linear forwards',
          }}
        />
      </div>
      <style>{`@keyframes agent-progress { from { width: 0% } to { width: 90% } }`}</style>
    </div>
  );
}

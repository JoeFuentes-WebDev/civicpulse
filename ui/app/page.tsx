'use client';

import { useState, useEffect } from 'react';
import { AgentRun, CivicReport } from '@shared/types';
import ReactMarkdown from 'react-markdown';

type Screen = 'report' | 'review' | 'confirmed';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('report');
  const [text, setText] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState('Locating...');
  const [run, setRun] = useState<AgentRun | null>(null);

  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Get GPS on load
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationName('Location found');
      },
      () => {
        setLocation({ lat: 37.7749, lng: -122.4194 });
        setLocationName('San Francisco');
      }
    );
  }, []);

  async function handleSubmit() {
    if (!text.trim() || !location) return;
    setIsLoading(true);

    // Fake progress messages
    const messages = [
      'Resolving your location...',
      'Classifying the issue...',
      'Checking location history...',
      'Drafting 311 submission...',
      'Finalizing report...',
    ];
    let i = 0;
    setProgressMessage(messages[0]);
    const interval = setInterval(() => {
      i++;
      if (i < messages.length) setProgressMessage(messages[i]);
    }, 7000);

    const input: CivicReport = {
      text,
      lat: location.lat,
      lng: location.lng,
      timestamp: new Date(),
    };


    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const { id } = await res.json();

    const poll = setInterval(async () => {
      const r = await fetch(`/api/run/${id}`);
      const data: AgentRun = await r.json();
      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(poll);
        clearInterval(interval);
        setRun(data);
        setScreen('review');
      }
    }, 1000);
  }

  async function handleApprove() {
    if (!run) return;

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: run.id }),
    });

    const { serviceRequestId } = await res.json();
    setServiceRequestId(serviceRequestId);
    setScreen('confirmed');
  }
  
  function handleReset() {
    setText('');
    setRun(null);
    setServiceRequestId(null);
    setIsLoading(false);
    setScreen('report');
  }

  return (
    <main style={{
      minHeight: '100dvh',
      background: '#FAFAFA',
      fontFamily: 'var(--font-sans)',
      width: '100%',
      maxWidth: '600px',
      margin: '0 auto',
      position: 'relative',
      boxSizing: 'border-box',
    }}>
      {screen === 'report' && (
        <ReportScreen
          text={text}
          setText={setText}
          locationName={locationName}
          isLoading={isLoading}
          progressMessage={progressMessage}
          onSubmit={handleSubmit}
        />
      )}
      {screen === 'review' && run && (
        <ReviewScreen
          run={run}
          onBack={() => { setScreen('report'); setIsLoading(false); }}
          onConfirm={handleApprove}
        />
      )}
      {screen === 'confirmed' && run && (
        <ConfirmedScreen
          run={run}
          serviceRequestId={serviceRequestId}
          onReset={handleReset}
        />
      )}
    </main>
  );
}

function ReportScreen({ text, setText, locationName, isLoading, progressMessage, onSubmit }: {
  text: string;
  setText: (t: string) => void;
  locationName: string;
  isLoading: boolean;
  progressMessage: string;
  onSubmit: () => void;
}) {
  return (
    <div style={{ padding: '24px 22px 240px' }}>

      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '40px', paddingTop: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#FF4500' }} />
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#111', letterSpacing: '-0.2px' }}>CivicPulse</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontSize: '13px', color: '#FF4500' }}>📍</span>
          <span style={{ fontSize: '12px', color: '#999' }}>{locationName}</span>
        </div>
      </div>

      {/* Hero */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '32px', fontWeight: 500, color: '#111', letterSpacing: '-1px', lineHeight: 1.15 }}>
          What are<br />you seeing?
        </div>
        <div style={{ fontSize: '14px', color: '#999', marginTop: '10px' }}>Describe it. We'll handle the rest.</div>
      </div>

      {/* Text input */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        style={{
          width: '100%', height: '100px', resize: 'none',
          fontSize: '15px', padding: '16px',
          borderRadius: '14px', border: '0.5px solid #E0E0E0',
          background: '#fff', color: '#111',
          fontFamily: 'inherit', boxSizing: 'border-box',
          lineHeight: 1.5, outline: 'none',
        }}
        placeholder="e.g. Pothole on Valencia near 18th..."
      />

      {/* Input buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '12px', marginBottom: '24px' }}>
        {[
          { icon: '📷', label: 'Photo' },
          { icon: '🎤', label: 'Voice' },
        ].map(({ icon, label }) => (
          <button key={label} style={{
            flex: 1, padding: '18px 10px',
            borderRadius: '14px', border: '0.5px solid #E8E8E8',
            background: '#fff', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '8px',
            fontSize: '13px', color: '#888', cursor: 'pointer',
          }}>
            <span style={{ fontSize: '26px' }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* CTA or Loading state */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxWidth: '600px',
        margin: '0 auto',
        padding: '16px 22px 32px',
        borderTop: '0.5px solid #F0F0F0',
        background: '#FAFAFA',
        zIndex: 10,
      }}>
        <button
          onClick={onSubmit}
          disabled={!text.trim() || isLoading}
          style={{
            width: '100%', padding: '18px', borderRadius: '14px', border: 'none',
            background: !text.trim() || isLoading ? '#FFB8A0' : '#FF4500',
            color: '#fff', fontSize: '15px', fontWeight: 500,
            cursor: !text.trim() || isLoading ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '8px', boxSizing: 'border-box', transition: 'background 0.2s',
          }}>
          {isLoading ? 'Working on it...' : 'Report Issue →'}
        </button>
      </div>

      {isLoading && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: '#999', marginBottom: '8px' }}>{progressMessage}</div>
          <div style={{ height: '2px', background: '#F0F0F0', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: '#FF4500', borderRadius: '2px',
              animation: 'progress 35s linear forwards',
            }} />
          </div>
          <style>{`@keyframes progress { from { width: 0% } to { width: 90% } }`}</style>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'center', marginTop: '14px' }}>
        <span style={{ fontSize: '11px', color: '#CCC' }}>🔒 Location used only to route your report</span>
      </div>

    </div>
  );
}

function ReviewScreen({ run, onBack, onConfirm }: {
  run: AgentRun;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const classifyStep = run.steps.find(s => s.name === 'classify_report')?.output as any;
  const draftStep = run.steps.find(s => s.name === 'draft_submission')?.output as any;
  const resolveStep = run.steps.find(s => s.name === 'resolve_location')?.output as any;

  const category = classifyStep?.category ?? draftStep?.category ?? '—';
  const address = resolveStep?.address ?? draftStep?.address_string ?? '—';
  console.log('run steps:', JSON.stringify(run.steps, null, 2));
  return (
    <div style={{ padding: '24px 22px 120px' }}>

      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px', paddingTop: '4px' }}>
        <button onClick={onBack} style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: '#F5F5F5', border: '0.5px solid #E8E8E8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, fontSize: '16px',
        }}>←</button>
        <span style={{ fontSize: '13px', color: '#AAA' }}>Review</span>
      </div>

      {/* Detail card */}
      <div style={{
        background: '#fff', borderRadius: '16px',
        border: '0.5px solid #EBEBEB', padding: '18px', marginBottom: '14px',
      }}>
        {/* Category chip from first classify step */}
        {run.steps[0] && (
          <div style={{ marginBottom: '14px' }}>
            <span style={{
              fontSize: '11px', padding: '5px 12px', borderRadius: '20px',
              fontWeight: 500, background: '#FFF0EB', color: '#CC3700',
            }}>
              {category}
            </span>
          </div>
        )}

        {/* Draft text */}
        <div style={{ fontSize: '14px', color: '#333', lineHeight: 1.6, marginBottom: '12px' }}>
          <ReactMarkdown>{run.draft ?? 'Processing...'}</ReactMarkdown>
        </div>

        <div style={{ height: '0.5px', background: '#F0F0F0', margin: '12px 0' }} />

        {/* Location */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#AAA' }}>
          <span style={{ color: '#FF4500' }}>📍</span>
          {address}
        </div>
      </div>

      <button style={{
        width: '100%', marginTop: '10px', padding: '16px',
        borderRadius: '14px', border: '0.5px solid #333',
        background: 'transparent', color: '#888', fontSize: '14px',
        cursor: 'pointer', boxSizing: 'border-box',
      }}>
        Edit report
      </button>

      <div style={{ height: '0.5px', background: '#F0F0F0', margin: '12px 0' }} />

      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxWidth: '600px',
        margin: '0 auto',
        padding: '16px 22px 32px',
        borderTop: '0.5px solid #F0F0F0',
        background: '#FAFAFA',
        zIndex: 10,
      }}>
  
        <button onClick={onConfirm} style={{
          width: '100%', padding: '18px', borderRadius: '14px', border: 'none',
          background: '#FF4500', color: '#fff', fontSize: '15px', fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: '8px', boxSizing: 'border-box',
        }}>
          Submit to 311 →
        </button>
      
      </div>
    </div>
  );
}

function ConfirmedScreen({ run, serviceRequestId, onReset }: {
  run: AgentRun;
  serviceRequestId: string | null;
  onReset: () => void;
}) {

  const classifyStep = run.steps.find(s => s.name === 'classify_report')?.output as any;
  const draftStep = run.steps.find(s => s.name === 'draft_submission')?.output as any;
  const resolveStep = run.steps.find(s => s.name === 'resolve_location')?.output as any;

  const category = classifyStep?.category ?? draftStep?.category ?? '—';
  const address = resolveStep?.address ?? draftStep?.address_string ?? '—';
  return (
    <div style={{ padding: '24px 22px 120px' }}>

      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px', paddingTop: '4px' }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: '#F5F5F5', border: '0.5px solid #E8E8E8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', color: '#666',
        }}>←</div>
        <span style={{ fontSize: '13px', color: '#AAA' }}>Confirmation</span>
      </div>

       {/* Confirmation banner */}
      <div style={{
        borderRadius: '14px', border: '0.5px solid #FFD4C7',
        background: '#FFF5F2', padding: '18px', marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '18px', color: '#FF4500' }}>✓</span>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#111' }}>Submitted to SF 311</span>
        </div>
        <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px', fontFamily: 'monospace' }}>
          {serviceRequestId ?? '—'}
        </div>
        <div style={{ fontSize: '12px', color: '#999', lineHeight: 1.5 }}>
          Typical response: 3–5 business days. Track on sf311.org.
        </div>
      </div>

      {/* Detail card */}
      <div style={{
        background: '#fff', borderRadius: '16px',
        border: '0.5px solid #EBEBEB', padding: '18px', marginBottom: '14px',
      }}>
        <div style={{ marginBottom: '14px' }}>
          <span style={{
            fontSize: '11px', padding: '5px 12px', borderRadius: '20px',
            fontWeight: 500, background: '#FFF0EB', color: '#CC3700',
          }}>
            {category}
          </span>
        </div>

        <div style={{ fontSize: '14px', color: '#333', lineHeight: 1.6, marginBottom: '12px' }}>
          <ReactMarkdown>{run.draft ?? '—'}</ReactMarkdown>
        </div>

        <div style={{ height: '0.5px', background: '#F0F0F0', margin: '12px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#AAA' }}>
          <span style={{ color: '#FF4500' }}>📍</span>
          {address}
        </div>
      </div>
      
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxWidth: '600px',
        margin: '0 auto',
        padding: '16px 22px 32px',
        borderTop: '0.5px solid #F0F0F0',
        background: '#FAFAFA',
        zIndex: 10,
      }}>
  
        <button onClick={onReset} style={{
          width: '100%', padding: '18px', borderRadius: '14px',
          border: '1.5px solid #FF4500', background: 'transparent',
          color: '#FF4500', fontSize: '15px', fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: '8px', boxSizing: 'border-box',
        }}>
          + Report another issue
        </button>
      </div>
    </div>
  );
}
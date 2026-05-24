'use client';

import { useState } from 'react';
import { AgentRun, CivicReport } from '@shared/types';

export default function Home() {
  const [text, setText] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);

  async function handleSubmit() {
    if (!text.trim()) return;
    setLoading(true);
    setRun(null);

    // Get real GPS coordinates from browser
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });

    const input: CivicReport = {
      text,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      timestamp: new Date(),
    };

    // Start the agent run
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const { id } = await res.json();

    // Poll for updates
    const interval = setInterval(async () => {
      const poll = await fetch(`/api/run/${id}`);
      const data: AgentRun = await poll.json();
      setRun(data);

      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(interval);
        setLoading(false);
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
  }

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-8">

      {/* Header */}
      <h1 className="text-2xl font-bold text-blue-600">
        CivicPulse — Validating UI
      </h1>

      {/* Input */}
      <div className="space-y-3">
        <textarea
          className="w-full border rounded p-3 text-sm h-24 resize-none"
          placeholder="Describe what you see... e.g. there are new tents on Valencia near 18th"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !text.trim()}
          className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Submit Report'}
        </button>
      </div>

      {/* Agent Steps */}
      {run && (
        <div className="space-y-2">
          <h2 className="font-semibold text-gray-700">Agent Steps</h2>
          {run.steps.map(step => (
            <div
              key={step.id}
              className="border rounded p-3 text-sm space-y-1"
            >
              <div className="flex items-center gap-2">
                <span>
                  {step.status === 'complete' && '✓'}
                  {step.status === 'running' && '⟳'}
                  {step.status === 'error' && '✗'}
                  {step.status === 'pending' && '○'}
                </span>
                <span className="font-medium">{step.name}</span>
              </div>
              {step.output && (
                <pre className="text-xs text-gray-500 bg-gray-50 p-2 rounded overflow-auto">
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              )}
              {step.error && (
                <p className="text-red-500 text-xs">{step.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Final Draft */}
      {run?.status === 'complete' && run.draft && (
        <div className="border-2 border-blue-200 rounded p-4 space-y-3">
          <h2 className="font-semibold text-blue-700">Draft Submission</h2>
          <p className="text-sm text-gray-700">{run.draft}</p>
          <div className="flex gap-3">
            <button 
              onClick={handleApprove}
              className="bg-green-600 text-white px-6 py-2 rounded text-sm">
              Approve + Submit
            </button>
            <button className="border px-6 py-2 rounded text-sm">
              Edit
            </button>
          </div>
        </div>
      )}

      {serviceRequestId && (
        <div className="border-2 border-green-200 rounded p-4 space-y-2">
          <h2 className="font-semibold text-green-700">Submitted to SF 311</h2>
          <p className="text-sm text-gray-700">
            Service Request ID: <span className="font-mono font-bold">{serviceRequestId}</span>
          </p>
          <p className="text-sm text-gray-500">
            The city has been notified. You will receive updates as the issue is addressed.
          </p>
        </div>
      )}

    </main>
  );
}
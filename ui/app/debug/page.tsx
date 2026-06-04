'use client';

import { useState } from 'react';
import { AgentRun, CivicReport } from '@shared/types';
import { isAutoSubmitted } from '../../lib/runRouting';
import ReactMarkdown from 'react-markdown';

function isMockSubmit(run: AgentRun, serviceRequestId: string | null): boolean {
  const id = serviceRequestId ?? run.serviceRequestId;
  return run.submission === 'mock' || (typeof id === 'string' && id.startsWith('MOCK-'));
}

function submitTitle(run: AgentRun, serviceRequestId: string | null): string {
  const mock = isMockSubmit(run, serviceRequestId);
  if (run.submission === 'auto' || (isAutoSubmitted(run) && run.submission !== 'user')) {
    return mock ? 'Auto-submitted (POC mock)' : 'Auto-submitted to 311';
  }
  return mock ? 'Submitted (POC mock)' : 'Submitted to SF 311';
}

export default function DebugPage() {
  const [text, setText] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [showRawRun, setShowRawRun] = useState(false);
  const [statusJson, setStatusJson] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const submitError =
    run?.steps.find(s => s.id === 'submit-error' || s.name === '311 Submit Error')?.error ??
    null;

  async function fetch311Status() {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/test/311-status');
      const data = await res.json();
      setStatusJson(JSON.stringify(data, null, 2));
    } catch (err) {
      setStatusJson(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleSubmit() {
    if (!text.trim()) return;
    setLoading(true);
    setRun(null);
    setServiceRequestId(null);
    setApproveError(null);
    setIsEditing(false);

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });
    });

    const input: CivicReport = {
      text,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      timestamp: new Date(),
    };

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const { id } = await res.json();

    const interval = setInterval(async () => {
      const poll = await fetch(`/api/run/${id}`);
      const data: AgentRun = await poll.json();
      setRun(data);

      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(interval);
        setLoading(false);
        if (isAutoSubmitted(data)) {
          setServiceRequestId(data.serviceRequestId ?? null);
        }
      }
    }, 1000);
  }

  async function handleRerun(updatedText: string) {
    if (!run) return;
    setRerunning(true);
    setApproveError(null);

    try {
      const res = await fetch(`/api/run/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: updatedText }),
      });

      const data: AgentRun = await res.json();
      if (!res.ok) return;

      setText(updatedText);
      setRun(data);
      setIsEditing(false);

      if (isAutoSubmitted(data)) {
        setServiceRequestId(data.serviceRequestId ?? null);
      } else {
        setServiceRequestId(null);
      }
    } finally {
      setRerunning(false);
    }
  }

  async function handleApprove() {
    if (!run) return;
    setApproveError(null);

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: run.id }),
    });

    const body = await res.json();
    if (!res.ok) {
      setApproveError(typeof body.error === 'string' ? body.error : 'Submit failed');
      return;
    }

    const id = body.serviceRequestId as string;
    setServiceRequestId(id);
    setRun({
      ...run,
      serviceRequestId: id,
      submission: body.mock ? 'mock' : 'user',
    });
  }

  const lastStep = run?.steps[run.steps.length - 1];
  const runningLabel =
    run?.status === 'running'
      ? `Running… ${run.steps.length} step(s)${lastStep ? ` · last: ${lastStep.name}` : ''}`
      : null;

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-blue-600">CivicPulse — Debug</h1>
          <p className="text-sm text-gray-500 mt-1">Agent inspector · POC mock submits</p>
        </div>
        <button
          type="button"
          onClick={fetch311Status}
          disabled={statusLoading}
          className="text-xs border rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 shrink-0"
        >
          {statusLoading ? 'Loading…' : '311 status'}
        </button>
      </div>

      {statusJson && (
        <pre className="text-xs bg-gray-900 text-green-200 p-3 rounded overflow-auto max-h-48">
          {statusJson}
        </pre>
      )}

      <div className="space-y-3">
        <textarea
          className="w-full border rounded p-3 text-sm h-24 resize-none"
          placeholder="Describe what you see… e.g. broken glass on 9th and Mission"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || rerunning || !text.trim()}
          className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Running agent…' : 'Run agent'}
        </button>
      </div>

      {submitError && (
        <div className="border-2 border-red-200 rounded p-4 bg-red-50 space-y-1">
          <h2 className="font-semibold text-red-800">311 submit error</h2>
          <p className="text-sm text-red-900">{submitError}</p>
        </div>
      )}

      {run && (
        <>
          <div className="border rounded p-4 space-y-2 bg-slate-50">
            <h2 className="font-semibold text-gray-800 text-sm">Run summary</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-gray-500">id</dt>
              <dd className="font-mono break-all">{run.id}</dd>
              <dt className="text-gray-500">status</dt>
              <dd>{run.status}</dd>
              <dt className="text-gray-500">needsReview</dt>
              <dd>{String(run.needsReview ?? '—')}</dd>
              <dt className="text-gray-500">confidence</dt>
              <dd>{run.confidence?.toFixed(2) ?? '—'}</dd>
              <dt className="text-gray-500">severity</dt>
              <dd>{run.severity ?? '—'}</dd>
              <dt className="text-gray-500">locationSource</dt>
              <dd>{run.locationSource ?? '—'}</dd>
              <dt className="text-gray-500">locationMention</dt>
              <dd>{run.locationMention ?? '—'}</dd>
              <dt className="text-gray-500">submission</dt>
              <dd>{run.submission ?? '—'}</dd>
              <dt className="text-gray-500">serviceRequestId</dt>
              <dd className="font-mono">{run.serviceRequestId ?? serviceRequestId ?? '—'}</dd>
            </dl>
          </div>

          <div className="space-y-2">
            <h2 className="font-semibold text-gray-700 text-sm">Agent steps</h2>
            {(run.steps ?? []).map(step => (
              <div key={step.id} className="border rounded p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span>
                    {step.status === 'complete' && '✓'}
                    {step.status === 'running' && '⟳'}
                    {step.status === 'error' && '✗'}
                    {step.status === 'pending' && '○'}
                  </span>
                  <span className="font-medium">{step.name}</span>
                  <span className="text-xs text-gray-400">{step.status}</span>
                </div>
                {step.error && (
                  <p className="text-xs text-red-700 bg-red-50 p-2 rounded">{step.error}</p>
                )}
                {step.output && (
                  <pre className="text-xs text-gray-500 bg-gray-50 p-2 rounded overflow-auto max-h-64">
                    {JSON.stringify(step.output, null, 2)}
                  </pre>
                )}
              </div>
            ))}
            {runningLabel && (
              <div className="border rounded p-3 text-sm text-gray-500 animate-pulse">
                {runningLabel}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowRawRun(v => !v)}
            className="text-xs text-blue-600 underline"
          >
            {showRawRun ? 'Hide raw run JSON' : 'Show raw run JSON'}
          </button>
          {showRawRun && (
            <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto max-h-96">
              {JSON.stringify(run, null, 2)}
            </pre>
          )}
        </>
      )}

      {run?.locationGeocodeFailed && run.locationMention && (
        <div className="border-2 border-amber-200 rounded p-4 space-y-2 bg-amber-50">
          <h2 className="font-semibold text-amber-800">Location not found</h2>
          <p className="text-sm text-amber-900">
            Could not geocode &ldquo;{run.locationMention}&rdquo; — review required.
          </p>
        </div>
      )}

      {run?.status === 'complete' && isAutoSubmitted(run) && (
        <div className="border-2 border-green-200 rounded p-4 space-y-2">
          <h2 className="font-semibold text-green-700">{submitTitle(run, serviceRequestId)}</h2>
          <p className="text-sm text-gray-600">
            confidence {run.confidence?.toFixed(2)} · severity {run.severity}
          </p>
          <p className="text-sm text-gray-700">
            Service Request ID:{' '}
            <span className="font-mono font-bold">{run.serviceRequestId}</span>
          </p>
          {isMockSubmit(run, serviceRequestId) && (
            <p className="text-xs text-gray-500">No real SF 311 ticket (SF_OPEN311_LIVE=false).</p>
          )}
        </div>
      )}

      {run?.status === 'complete' && run.draft && !isAutoSubmitted(run) && !isEditing && (
        <div className="border-2 border-blue-200 rounded p-4 space-y-3">
          <h2 className="font-semibold text-blue-700">Draft (needs review)</h2>
          <p className="text-xs text-gray-500">
            needsReview={String(run.needsReview)} · confidence {run.confidence?.toFixed(2) ?? '—'}
          </p>
          <div className="text-sm text-gray-700 prose prose-sm max-w-none">
            <ReactMarkdown>{run.draft}</ReactMarkdown>
          </div>
          {approveError && (
            <p className="text-sm text-red-700 bg-red-50 p-2 rounded">{approveError}</p>
          )}
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleApprove}
              disabled={rerunning}
              className="bg-green-600 text-white px-6 py-2 rounded text-sm disabled:opacity-50"
            >
              Approve + Submit
            </button>
            <button
              type="button"
              onClick={() => {
                setEditText(run.input.text ?? text);
                setIsEditing(true);
              }}
              disabled={rerunning}
              className="border px-6 py-2 rounded text-sm disabled:opacity-50"
            >
              Edit & rerun
            </button>
          </div>
        </div>
      )}

      {run && isEditing && (
        <div className="border rounded p-4 space-y-3 bg-white">
          <h2 className="font-semibold text-gray-800 text-sm">Edit description</h2>
          <textarea
            className="w-full border rounded p-3 text-sm h-24 resize-none"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            disabled={rerunning}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleRerun(editText.trim())}
              disabled={!editText.trim() || rerunning}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              {rerunning ? 'Rerunning…' : 'Save & rerun agent'}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={rerunning}
              className="border px-4 py-2 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {serviceRequestId && run && !isAutoSubmitted(run) && (
        <div className="border-2 border-green-200 rounded p-4 space-y-2">
          <h2 className="font-semibold text-green-700">{submitTitle(run, serviceRequestId)}</h2>
          <p className="text-sm text-gray-700">
            Service Request ID: <span className="font-mono font-bold">{serviceRequestId}</span>
          </p>
          {isMockSubmit(run, serviceRequestId) && (
            <p className="text-xs text-gray-500">No real SF 311 ticket (SF_OPEN311_LIVE=false).</p>
          )}
        </div>
      )}

    </main>
  );
}

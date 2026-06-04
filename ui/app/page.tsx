'use client';

import { useState, useEffect, useRef } from 'react';
import { AgentRun, CivicReport } from '@shared/types';
import { isAutoSubmitted } from '../lib/runRouting';
import { AgentProgressBar } from './components/AgentProgressBar';
import ReactMarkdown from 'react-markdown';

type Screen = 'report' | 'review' | 'confirmed';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('report');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState('Locating...');
  const [run, setRun] = useState<AgentRun | null>(null);

  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);

  // Get GPS on load
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocation({ lat: 37.7749, lng: -122.4194 });
      setLocationName('San Francisco (default)');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationName('Using your device location');
      },
      () => {
        setLocation({ lat: 37.7749, lng: -122.4194 });
        setLocationName('San Francisco (location denied)');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }, []);

  async function handleSubmit() {
    if (!text.trim() || !location) return;
    setIsLoading(true);
    setRun(null);
    setServiceRequestId(null);

    const input: CivicReport = {
      text,
      lat: location.lat,
      lng: location.lng,
      timestamp: new Date(),
      ...(photo ? { photoUrl: photo } : {}),
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
      console.log('poll status:', data.status, 'steps:', data.steps?.length);
      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(poll);
        setRun(data);
        setIsLoading(false);
        if (data.status === 'complete' && isAutoSubmitted(data)) {
          setServiceRequestId(data.serviceRequestId ?? null);
          setScreen('confirmed');
        } else if (data.status === 'complete') {
          setScreen('review');
        } else {
          setScreen('report');
        }
      }
    }, 1000);
  }

  async function handleRerun(updatedText: string) {
    if (!run) return;
    setIsRerunning(true);

    try {
      const res = await fetch(`/api/run/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: updatedText }),
      });

      const data = await res.json();
      if (!res.ok) return;

      setText(updatedText);
      setRun(data);

      if (isAutoSubmitted(data)) {
        setServiceRequestId(data.serviceRequestId ?? null);
        setScreen('confirmed');
      }
    } finally {
      setIsRerunning(false);
    }
  }

  async function handleApprove() {
    if (!run) return;

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: run.id }),
    });

    const body = await res.json();
    if (!res.ok) return;

    const id = body.serviceRequestId as string;
    setServiceRequestId(id);
    setRun({
      ...run,
      serviceRequestId: id,
      submission: body.mock ? 'mock' : 'user',
    });
    setScreen('confirmed');
  }
  
  function handleReset() {
    setText('');
    setPhoto(null);
    setRun(null);
    setServiceRequestId(null);
    setIsLoading(false);
    setScreen('report');
  }

  const submitError =
    run?.steps.find(s => s.id === 'submit-error' || s.name === '311 Submit Error')?.error ?? null;

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
          photo={photo}
          setPhoto={setPhoto}
          locationName={locationName}
          isLoading={isLoading}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      )}
      {screen === 'review' && run && (
        <ReviewScreen
          run={run}
          isRerunning={isRerunning}
          onBack={() => { setScreen('report'); setIsLoading(false); }}
          onConfirm={handleApprove}
          onRerun={handleRerun}
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

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4MB — keep run payload under store limits

// Minimal Web Speech API typing (not in the standard DOM lib; prefixed on most browsers).
interface SpeechResultAlternative { transcript: string }
type SpeechResult = ArrayLike<SpeechResultAlternative> & { isFinal: boolean };
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function ReportScreen({ text, setText, photo, setPhoto, locationName, isLoading, submitError, onSubmit }: {
  text: string;
  setText: (t: string) => void;
  photo: string | null;
  setPhoto: (p: string | null) => void;
  locationName: string;
  isLoading: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef('');
  const finalTranscriptRef = useRef('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionCtor()));
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  function startRecording() {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      setVoiceError('Voice input is not supported in this browser.');
      return;
    }

    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    // Append to whatever is already in the text field; keep it editable.
    baseTextRef.current = text.trim() ? `${text.trim()} ` : '';
    finalTranscriptRef.current = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalTranscriptRef.current += transcript;
        else interim += transcript;
      }
      setText((baseTextRef.current + finalTranscriptRef.current + interim).trimStart());
    };
    recognition.onerror = (event) => {
      setVoiceError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was denied.'
          : 'Voice input error — please try again.'
      );
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    setVoiceError(null);
    setIsRecording(true);
    recognition.start();
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('Photo is too large (max 4MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoError(null);
      setPhoto(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.onerror = () => setPhotoError('Could not read that image.');
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ padding: '24px 22px 240px' }}>

      {submitError && (
        <div style={{
          borderRadius: '14px', border: '0.5px solid #FFD4C7',
          background: '#FFF5F2', padding: '16px', marginBottom: '16px',
          fontSize: '13px', color: '#663', lineHeight: 1.5,
        }}>
          <strong style={{ color: '#C30' }}>311 submit blocked</strong>
          <div style={{ marginTop: '8px' }}>{submitError}</div>
        </div>
      )}

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

      {/* Hidden file input — opened by the Photo button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        style={{ display: 'none' }}
      />

      {/* Photo preview */}
      {photo && (
        <div style={{ position: 'relative', marginTop: '12px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt="Selected report photo"
            style={{
              width: '100%', maxHeight: '220px', objectFit: 'cover',
              borderRadius: '14px', border: '0.5px solid #E8E8E8', display: 'block',
            }}
          />
          <button
            type="button"
            onClick={() => setPhoto(null)}
            aria-label="Remove photo"
            style={{
              position: 'absolute', top: '8px', right: '8px',
              width: '28px', height: '28px', borderRadius: '50%', border: 'none',
              background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '15px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      )}

      {photoError && (
        <div style={{ fontSize: '12px', color: '#C30', marginTop: '8px' }}>{photoError}</div>
      )}

      {/* Input buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '12px', marginBottom: '24px' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            flex: 1, padding: '18px 10px',
            borderRadius: '14px',
            border: photo ? '0.5px solid #FF4500' : '0.5px solid #E8E8E8',
            background: '#fff', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '8px',
            fontSize: '13px', color: photo ? '#FF4500' : '#888', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '26px' }}>📷</span>
          {photo ? 'Change photo' : 'Photo'}
        </button>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!voiceSupported}
          title={voiceSupported ? 'Dictate your report' : 'Voice input not supported in this browser'}
          style={{
            flex: 1, padding: '18px 10px',
            borderRadius: '14px',
            border: isRecording ? '0.5px solid #FF4500' : '0.5px solid #E8E8E8',
            background: isRecording ? '#FFF5F2' : '#fff',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '8px',
            fontSize: '13px', color: isRecording ? '#FF4500' : '#888',
            cursor: voiceSupported ? 'pointer' : 'not-allowed',
            opacity: voiceSupported ? 1 : 0.5,
          }}
        >
          <span style={{ fontSize: '26px' }}>{isRecording ? '⏹' : '🎤'}</span>
          {isRecording ? 'Stop' : 'Voice'}
        </button>
      </div>

      {isRecording && (
        <div style={{ fontSize: '12px', color: '#FF4500', marginTop: '-12px', marginBottom: '16px' }}>
          Listening… speak now, then tap Stop. You can edit the text after.
        </div>
      )}

      {voiceError && (
        <div style={{ fontSize: '12px', color: '#C30', marginTop: '-12px', marginBottom: '16px' }}>{voiceError}</div>
      )}

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

      <AgentProgressBar active={isLoading} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'center', marginTop: '14px' }}>
        <span style={{ fontSize: '11px', color: '#CCC' }}>🔒 Location used only to route your report</span>
      </div>

    </div>
  );
}

function ReviewScreen({ run, isRerunning, onBack, onConfirm, onRerun }: {
  run: AgentRun;
  isRerunning: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onRerun: (text: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(run.input.text ?? '');

  useEffect(() => {
    if (!isEditing) {
      setEditText(run.input.text ?? '');
    }
  }, [run.input.text, isEditing]);

  const classifyStep = run.steps.find(s => s.name === 'classify_report')?.output as Record<string, unknown> | undefined;
  const draftStep = run.steps.find(s => s.name === 'draft_submission')?.output as Record<string, unknown> | undefined;
  const resolveStep = run.steps.find(s => s.name === 'resolve_location')?.output as Record<string, unknown> | undefined;

  const category = (classifyStep?.category ?? draftStep?.category ?? '—') as string;
  const address = (resolveStep?.address ?? draftStep?.address_string ?? '—') as string;

  async function handleSaveEdit() {
    if (!editText.trim() || isRerunning) return;
    setIsEditing(false);
    await onRerun(editText.trim());
  }

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

      {run.locationGeocodeFailed && run.locationMention && (
        <div style={{
          borderRadius: '14px', border: '0.5px solid #FFE0B2',
          background: '#FFF8E6', padding: '14px 16px', marginBottom: '12px',
          fontSize: '13px', color: '#8A6100', lineHeight: 1.5,
        }}>
          We couldn&apos;t find &ldquo;{run.locationMention}&rdquo;. The address below is
          from your device location — edit your description and try again, or confirm
          this is correct before submitting.
        </div>
      )}

      <AgentProgressBar active={isRerunning} />

      {!isRerunning && isEditing ? (
        <div style={{
          background: '#fff', borderRadius: '16px',
          border: '0.5px solid #EBEBEB', padding: '18px', marginBottom: '14px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#111', marginBottom: '10px' }}>
            Edit description
          </div>
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            disabled={isRerunning}
            style={{
              width: '100%', height: '120px', resize: 'vertical',
              fontSize: '15px', padding: '14px',
              borderRadius: '12px', border: '0.5px solid #E0E0E0',
              fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <button
              onClick={handleSaveEdit}
              disabled={!editText.trim() || isRerunning}
              style={{
                flex: 1, padding: '14px', borderRadius: '12px', border: 'none',
                background: !editText.trim() || isRerunning ? '#FFB8A0' : '#FF4500',
                color: '#fff', fontSize: '14px', fontWeight: 500,
                cursor: !editText.trim() || isRerunning ? 'default' : 'pointer',
              }}
            >
              {isRerunning ? 'Working on it…' : 'Save & refresh'}
            </button>
            <button
              onClick={() => {
                setEditText(run.input.text ?? '');
                setIsEditing(false);
              }}
              disabled={isRerunning}
              style={{
                flex: 1, padding: '14px', borderRadius: '12px',
                border: '0.5px solid #E0E0E0', background: '#fff',
                color: '#666', fontSize: '14px',
                cursor: isRerunning ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !isRerunning ? (
        <>
          <div style={{
            background: '#fff', borderRadius: '16px',
            border: '0.5px solid #EBEBEB', padding: '18px', marginBottom: '14px',
          }}>
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

            <div style={{ fontSize: '14px', color: '#333', lineHeight: 1.6, marginBottom: '12px' }}>
              <ReactMarkdown>{run.draft ?? 'Processing...'}</ReactMarkdown>
            </div>

            <div style={{ height: '0.5px', background: '#F0F0F0', margin: '12px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#AAA' }}>
              <span style={{ color: '#FF4500' }}>📍</span>
              {address}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditText(run.input.text ?? '');
              setIsEditing(true);
            }}
            disabled={isRerunning}
            style={{
              width: '100%', marginTop: '10px', padding: '16px',
              borderRadius: '14px', border: '0.5px solid #333',
              background: 'transparent', color: '#888', fontSize: '14px',
              cursor: isRerunning ? 'default' : 'pointer', boxSizing: 'border-box',
            }}
          >
            Edit report
          </button>
        </>
      ) : null}

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
  
        <button
          onClick={onConfirm}
          disabled={isRerunning || isEditing}
          style={{
            width: '100%', padding: '18px', borderRadius: '14px', border: 'none',
            background: isRerunning || isEditing ? '#FFB8A0' : '#FF4500',
            color: '#fff', fontSize: '15px', fontWeight: 500,
            cursor: isRerunning || isEditing ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '8px', boxSizing: 'border-box',
          }}
        >
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
  const id = serviceRequestId ?? run.serviceRequestId ?? '—';
  const isMock =
    run.submission === 'mock' || (typeof id === 'string' && id.startsWith('MOCK-'));
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
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#111' }}>
            {isMock ? 'Report recorded (POC)' : 'Submitted to SF 311'}
          </span>
        </div>
        <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px', fontFamily: 'monospace' }}>
          {id}
        </div>
        <div style={{ fontSize: '12px', color: '#999', lineHeight: 1.5 }}>
          {isMock
            ? 'Dev mode: agent, geocode, and classification ran end-to-end. No real SF 311 ticket was filed.'
            : 'Typical response: 3–5 business days. Track on sf311.org.'}
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